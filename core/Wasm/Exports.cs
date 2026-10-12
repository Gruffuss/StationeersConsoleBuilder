using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices.JavaScript;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using VectorBuilder.Core;

namespace VectorBuilder.Wasm
{
    // JSON shapes for the page. Source-generated: the published app is trimmed, which turns reflection-based serialisation off.
    public sealed record StatusJson(string state, string? error, long instructions, string[] output, string active,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Dictionary<string, string>? persist,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double[]? memory,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DeviceWrite[]? writes);

    [JsonSourceGenerationOptions(NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals)]
    [JsonSerializable(typeof(StatusJson))]
    internal sealed partial class Json : JsonSerializerContext { }

    // Nothing here throws across JS interop: every export catches everything, and even writing the failure reply is
    // guarded. Out of memory is the exception: a runtime at its heap cap stayed unreliable (frames kept failing, or the
    // next call hung), so it ends the runtime, and the page replaces the worker.
    [System.Runtime.Versioning.SupportedOSPlatform("browser")]
    public static partial class Exports
    {
        static ChipRunner? chip;  // null until a load, or after a load whose chip could not be made
        static PointerInput? pointer;

        const string StatusFailed = """{"state":"Halted","error":"the core could not write its status","instructions":0,"output":[],"active":""}""";

        // Written without the serialiser, so it cannot fail the way the frame it replaces did.
        static readonly byte[] FrameFailed = Bare("""{"elements":[],"text":[],"problems":[{"element":-1,"message":"the core could not write the frame"}],"images":[],"pending":[]}""");

        // halted: a failure stops the chip's status (a load or tick that threw); an editor or simulation error does not.
        static string Reply(string? failure = null, bool halted = true)
        {
            try
            {
                var s = chip?.Stationeers;
                Dictionary<string, string>? persist = null;
                double[]? memory = null;
                if (s is { PersistChanged: true }) { persist = new(s.Persist); s.PersistChanged = false; }
                if (s is { MemoryChanged: true }) { memory = (double[])s.Memory.Clone(); s.MemoryChanged = false; }
                var writes = s?.TakeWrites();
                return JsonSerializer.Serialize(new StatusJson(failure != null && halted || chip == null ? "Halted" : chip.State.ToString(),
                    failure ?? chip?.Error, chip?.LastInstructions ?? 0, chip?.Output.ToArray() ?? [], chip?.Screens.ActiveSurface ?? "",
                    persist, memory, writes is { Length: > 0 } ? writes : null), Json.Default.StatusJson);
            }
            catch (Exception e)
            {
                FailOnOutOfMemory(e);
                return StatusFailed;
            }
        }

        static void FailOnOutOfMemory(Exception e)
        {
            if (e is OutOfMemoryException)
                Environment.FailFast("out of memory");
        }

        static string MessageOf(Exception e)
        {
            FailOnOutOfMemory(e);
            try { return e.Message; } catch { return e.GetType().Name; }
        }

        // Last-resort empty VBF2 frame; the VBF3 reader retains VBF2 compatibility. Its JSON is `json`.
        static byte[] Bare(string json)
        {
            var body = Encoding.UTF8.GetBytes(json);
            var frame = new byte[20 + body.Length];
            "VBF2"u8.CopyTo(frame);
            BitConverter.TryWriteBytes(frame.AsSpan(16), body.Length);
            body.CopyTo(frame, 20);
            return frame;
        }

        static readonly SurfaceFrame Empty = new([], [], [], [], [], [], [], []);

        [JSExport]
        public static Task<string> CheckExport(string lua, string host, string pages) => ExportCheck.RunJsonAsync(lua, host, pages);

        [JSExport]
        public static Task<string> CaptureScript(string lua, int width, int height, string host, int allowanceMs) =>
            AdoptCapture.RunJsonAsync(lua, width, height, host, allowanceMs);

        // Written ahead, so it cannot fail the way the reply it replaces did.
        static readonly byte[] PictureReplyFailed = Pictures.Reply(new(Error: "the core could not write its picture reply"));

        static byte[] PictureFailure(Exception e)
        {
            try { return Pictures.Reply(new(Error: MessageOf(e))); }
            catch (Exception failure) { FailOnOutOfMemory(failure); return PictureReplyFailed; }
        }

        // Replies leave as a view on the managed array, which the page copies and then disposes: a byte[] return would
        // make one more full copy in native memory on its way out. Pictures checks each step against the free memory.
        static ArraySegment<byte> PictureRead(Func<byte[]> read)
        {
            try { return read(); }
            catch (Exception e) { return PictureFailure(e); }
        }

        static byte[]? pictureInput;  // between PictureInput and the read that takes it
        static string? pictureInputNote;

        /// <summary>Room for a read's input, as a view the page writes it into and then disposes, before it calls
        /// ReadPicture or ReadPictureBytes. Written in place, the input takes no native copy on the way in (a string or
        /// byte[] argument takes one, made before the core can collect the previous read's arrays). Empty when it does not
        /// fit, and the read then says why.</summary>
        [JSExport]
        [return: JSMarshalAs<JSType.MemoryView>]
        public static ArraySegment<byte> PictureInput(int length)
        {
            pictureInput = null;
            try { pictureInput = Pictures.Hold(length, out pictureInputNote); }
            catch (Exception e) { pictureInputNote = MessageOf(e); }
            return pictureInput ?? [];
        }

        static byte[]? TakeInput()
        {
            var input = pictureInput;
            pictureInput = null;
            return input;
        }

        static byte[] NoInput() => Pictures.Reply(pictureInputNote != null ? new(Note: pictureInputNote) : new(Error: "the picture did not reach the core"));

        /// <summary>A data: URL, written into PictureInput's view as UTF-8. A binary reply (Pictures' remarks): the pixels
        /// stay out of JSON. The page copies the view and disposes it.</summary>
        [JSExport]
        [return: JSMarshalAs<JSType.MemoryView>]
        public static ArraySegment<byte> ReadPicture() => PictureRead(() =>
        {
            var utf8 = TakeInput();
            if (utf8 == null) return NoInput();
            var src = Pictures.Text(ref utf8, out var note);
            return src != null ? Pictures.Read(src) : Pictures.Reply(new(Note: note));
        });

        /// <summary>Fetched bytes, written into PictureInput's view, classified and decoded by the same path as a data URL.
        /// A PNG or JPEG reply leaves the file out: the page sent it. The page copies the view and disposes it.</summary>
        [JSExport]
        [return: JSMarshalAs<JSType.MemoryView>]
        public static ArraySegment<byte> ReadPictureBytes() => PictureRead(() =>
        {
            var bytes = TakeInput();
            return bytes != null ? Pictures.ReadBytes(bytes, echo: false) : NoInput();
        });

        [JSExport]
        public static string SetImage(string src, int width, int height, string? error)
        {
            try { Pictures.Set(src, width, height, error); return "{}"; }
            catch (Exception e)
            {
                try { return Pictures.Json(new(Error: MessageOf(e))); }
                catch (Exception failure) { FailOnOutOfMemory(failure); return """{"error":"the core could not write its picture reply"}"""; }
            }
        }

        /// <summary>`sizes`: JSON `{ "&lt;surface&gt;": [w, h] }`; `host`: the HostJson the page wrote (web/src/codegen/hostOf.ts); blank is the empty host.</summary>
        [JSExport]
        public static async Task<string> Load(string lua, int width, int height, string sizes, string host)
        {
            try
            {
                chip = null;
                var h = HostJson.Parse(host, out var hostError);
                if (hostError != null && h == HostJson.Empty)
                    return Reply(hostError);
                static int Budget(int? b, int fallback) => b is int v ? Math.Clamp(v / 1000 * 1000, 1000, 10_000_000) : fallback;
                chip = new ChipRunner(Budget(h.budgets?.load, 500_000), Budget(h.budgets?.tick, 50_000), host: h);
                pointer = new PointerInput(chip);
                chip.Screens.Beta = h.beta;
                chip.Screens.Size = (width, height);  // ui:size() answers these from the first line the script runs
                chip.Screens.SetSizes(sizes);  // a bad entry is skipped alone; a bad map leaves every surface at Size
                await chip.LoadAsync(lua);
                return Reply(chip.Error ?? hostError, halted: false);
            }
            catch (Exception e) { return Reply(MessageOf(e)); }
        }

        /// <summary>The builder visits a page: the script's VB.go(id) runs first in the next tick (the builder's own call, not a host API).</summary>
        [JSExport]
        public static string Visit(string pageId)
        {
            try
            {
                if (chip == null)
                    return Reply("no chip is loaded", halted: false);
                chip.Screens.QueueVisit(pageId);
                return Reply();
            }
            catch (Exception e) { return Reply(MessageOf(e), halted: false); }
        }

        /// <summary>A live change of simulated values, stored writes or persist (SimJson), with no reload.</summary>
        [JSExport]
        public static string Sim(string json)
        {
            try
            {
                if (chip == null)
                    return Reply("no chip is loaded", halted: false);
                var s = SimJson.Parse(json, out var error);
                if (s == null)
                    return Reply(error ?? "the change could not be read", halted: false);
                chip.Stationeers.Sim(s);
                return Reply();
            }
            catch (Exception e) { return Reply(MessageOf(e), halted: false); }
        }

        /// <summary>Play mode's pointer (surface px; type down, up, move, leave or wheel; dy wheel notches, up positive).</summary>
        [JSExport]
        public static string Pointer(string surface, double x, double y, string type, double dy, int pointerId)
        {
            try
            {
                if (chip == null || pointer == null)
                    return Reply("no chip is loaded", halted: false);
                pointer.Apply(surface, x, y, type, dy, pointerId);
                return Reply();
            }
            catch (Exception e) { return Reply(MessageOf(e), halted: false); }
        }

        [JSExport]
        public static async Task<string> Tick()
        {
            try { if (chip != null) await chip.TickAsync(0.5); return Reply(); }
            catch (Exception e) { return Reply(MessageOf(e)); }
        }

        /// <summary>The surface as VBF3 (FrameWriter). pixelsPerUnit = canvas px per surface px, so feathers stay ~1.3 device px.</summary>
        [JSExport]
        public static byte[] Frame(string surface, double pixelsPerUnit, bool tagNodes)
        {
            try { return FrameWriter.Write(chip == null ? Empty : Compositor.Compose(chip, surface, (float)pixelsPerUnit, tagNodes)); }
            catch (Exception e)
            {
                try { return FrameWriter.Write(Empty with { Problems = [new FrameProblem(-1, $"frame failed: {MessageOf(e)}")] }); }
                catch (Exception again)
                {
                    FailOnOutOfMemory(again);
                    return FrameFailed;
                }
            }
        }

        /// <summary>
        /// The editor's hot-swap (M1 ruling 8): merges `src` into the element's props and re-parses its scene, keeping its
        /// clock and data. Without a live scene, queues the text for the page's pending declaration.
        /// </summary>
        [JSExport]
        public static string Patch(string surface, string elementId, string src)
        {
            try
            {
                if (chip == null)
                    return Reply("no chip is loaded");
                if (chip.Vectors.HotSwap(surface, elementId, src))
                    return Reply();
                // No live scene yet (a page the chip has not built): its declaration will carry this text (VB.setSrc in the next tick).
                chip.Screens.QueueSrc(surface, src);
                return Reply();
            }
            catch (Exception e) { return Reply(MessageOf(e), halted: false); }  // a failed patch is the editor's, not the chip's
        }
    }
}
