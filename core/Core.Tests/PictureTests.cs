using System;
using System.Buffers.Binary;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using ScriptedScreensVector;
using VectorBuilder.Core;

static class PictureTests
{
    // A read's VBP1 reply (Pictures' remarks): its metadata and payload.
    static (PictureResult Meta, byte[] Payload) Reply(byte[] reply)
    {
        if (reply.Length < Pictures.Header || Encoding.ASCII.GetString(reply, 0, 4) != "VBP1") return (new(Error: "not a VBP1 reply"), []);
        var length = BinaryPrimitives.ReadInt32LittleEndian(reply.AsSpan(4));
        var meta = JsonSerializer.Deserialize<PictureResult>(reply.AsSpan(Pictures.Header, length), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        return (meta, reply[(Pictures.Header + length)..]);
    }

    const string Source = "data:image/png;base64,iVBORw0KGgo=";
    static SurfaceFrame Draw(string options = "", string src = Source) => FrameTests.Draw(FrameTests.Src(
        $"SCENE w=100 h=100 fit=stretch\nR w=100 h=100 f=#123456\nIMG x=10 y=10 w=80 h=80 src=\"{src}\" {options}\nR x=90 y=90 w=10 h=10 f=#fff"), 100, 100);

    public static void Run(Action<bool, string> check)
    {
        var pending = Draw();
        check(pending.Images.Length == 0 && pending.Pending.SequenceEqual([Source]), "picture: pending until supplied");
        Pictures.Set(Source, 4, 2, null);
        var loaded = Draw();
        check(loaded.Images is [{ Src: Source, Element: 0, Count: 6 }] && loaded.Pending.Length == 0
            && loaded.Uv.Length == loaded.Positions.Length && loaded.Uv.All(u => u is >= 0 and <= 1), "picture: supplied quad and UVs");
        if (loaded.Images.Length > 0)
        {
            var image = loaded.Images[0];
            check(image.First > 0 && image.First + image.Count < loaded.Indices.Length
                && loaded.Indices.Skip(image.First).Take(image.Count).Distinct().Count() == 4, "picture: image index range preserves colour-image-colour order");
        }
        else check(false, "picture: image index range preserves colour-image-colour order");

        bool Uvs(SurfaceFrame f, float u0, float u1, float v0, float v1, int count)
        {
            if (f.Images is not [{ } image] || image.Count != count) return false;
            var vertices = f.Indices.Skip(image.First).Take(image.Count).Distinct().ToArray();
            var us = vertices.Select(v => f.Uv[2 * v]).ToArray();
            var vs = vertices.Select(v => f.Uv[2 * v + 1]).ToArray();
            return Math.Abs(us.Min() - u0) < 1e-6 && Math.Abs(us.Max() - u1) < 1e-6
                && Math.Abs(vs.Min() - v0) < 1e-6 && Math.Abs(vs.Max() - v1) < 1e-6;
        }
        check(Uvs(Draw("fit=cover"), .25f, .75f, 0, 1, 6), "picture: fit cover crops the long side");
        check(Uvs(Draw("uv=[0.25,0.25,0.75,0.75]"), .25f, .75f, .25f, .75f, 6), "picture: explicit UV crop");
        check(Uvs(Draw("tile=[40,40]"), 0, 1, 0, 1, 54), "picture: centred tile emits nine clipped quads with the mod's UVs");
        Pictures.Set(Source, 8, 8, null);
        check(Uvs(Draw("slice=[2,2,2,2] bw=[10,10,10,10]"), 0, 1, 0, 1, 54), "picture: nine-slice emits nine quads with the mod's UVs");
        var pointSrc = "https://example.com/point.png";
        check(Draw("smp=point", pointSrc).Pending.SequenceEqual(["point:" + pointSrc]), "picture: point sampling has its own pending key");
        Pictures.Set("point:" + pointSrc, 4, 2, null);
        check(Draw("smp=point", pointSrc).Images is [{ Src: "point:https://example.com/point.png" }]
            && Draw(src: pointSrc).Images.Length == 1, "picture: supplying a point key registers both cache keys");
        Pictures.Set(Source, 0, 0, "not a PNG, JPEG, BMP or GIF");
        var error = Draw();
        check(error.Pending.Length == 0 && error.Problems.Any(p => p.Message == $"IMG \"{Source}\": not a PNG, JPEG, BMP or GIF"), "picture: errors as the mod");

        var bmp = new byte[62];
        bmp[0] = (byte)'B'; bmp[1] = (byte)'M';
        BinaryPrimitives.WriteInt32LittleEndian(bmp.AsSpan(10), 54);
        BinaryPrimitives.WriteInt32LittleEndian(bmp.AsSpan(14), 40);
        BinaryPrimitives.WriteInt32LittleEndian(bmp.AsSpan(18), 2);
        BinaryPrimitives.WriteInt32LittleEndian(bmp.AsSpan(22), 1);
        bmp[26] = 1; bmp[28] = 24;
        bmp[56] = 255; bmp[58] = 255; // BGR: red, green.
        var (b, bRgba) = Reply(Pictures.Read("data:application/octet-stream;base64," + Convert.ToBase64String(bmp)));
        check(b is { Format: "bmp", Width: 2, Height: 1, Error: null } && bRgba.SequenceEqual(new byte[] { 255, 0, 0, 255, 0, 255, 0, 255 }), "picture: ReadPicture BMP size and first pixels");
        // 1×2, stored bottom-up: red on the bottom row, green on the top. The reply is bottom row first, as WebGL uploads.
        var tall = new byte[62];
        bmp.AsSpan(0, 54).CopyTo(tall);
        BinaryPrimitives.WriteInt32LittleEndian(tall.AsSpan(18), 1);
        BinaryPrimitives.WriteInt32LittleEndian(tall.AsSpan(22), 2);
        tall[56] = 255; tall[58 + 1] = 255;
        var (t, tRgba) = Reply(Pictures.ReadBytes(tall));
        check(t is { Width: 1, Height: 2 } && tRgba.SequenceEqual(new byte[] { 255, 0, 0, 255, 0, 255, 0, 255 }), "picture: BMP reply rows are bottom row first");
        var gif = Convert.FromBase64String("R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=");
        var (g, gRgba) = Reply(Pictures.Read("data:image/gif;base64," + Convert.ToBase64String(gif)));
        check(g is { Format: "gif", Width: 1, Height: 1, Error: null } && gRgba.SequenceEqual(new byte[] { 255, 255, 255, 255 }), "picture: ReadPicture GIF first frame and pixel");
        var (png, pngBytes) = Reply(Pictures.Read(Source));
        var (jpeg, jpegBytes) = Reply(Pictures.ReadBytes([255, 216, 255, 0]));
        var (_, sentJpeg) = Reply(Pictures.ReadBytes([255, 216, 255, 0], echo: false));
        check(png is { Format: "png", Error: null } && pngBytes.SequenceEqual(Convert.FromBase64String("iVBORw0KGgo="))
            && jpeg is { Format: "jpeg", Error: null } && jpegBytes.SequenceEqual(new byte[] { 255, 216, 255, 0 }) && sentJpeg.Length == 0,
            "picture: PNG and fetched JPEG bytes stay for browser decoding, and are not sent back to the page that sent them");
        check(Reply(Pictures.Read("data:image/webp;base64,UklGRnh4eHhXRUJQ")).Meta.Error == "not a PNG, JPEG, BMP or GIF", "picture: ReadPicture refuses WEBP as the mod");
        check(Reply(Pictures.Read("data:image/png;base64,!")).Meta.Error == "unreadable data: URL"
            && Reply(Pictures.Read("data:image/png")).Meta.Error == "unreadable data: URL", "picture: ReadPicture malformed data URL");
        check(Reply(Pictures.Read("data:x,%89PNG%0D%0A%1A%0A")).Meta is { Format: "png", Error: null }, "picture: percent-encoded data URL");
        check(Pictures.TooLarge(Pictures.Small - 1, "x") == null
            && Pictures.TooLarge(long.MaxValue / 2, "decoding this picture") is { } note && note.StartsWith("too large to preview here: decoding this picture needs about ")
            && note.EndsWith(" MB free"), "picture: a step that does not fit is too large to preview here");
        byte[]? utf8 = Encoding.UTF8.GetBytes(Source);
        check(Pictures.Text(ref utf8, out var textNote) == Source && utf8 == null && textNote == null, "picture: a data URL sent as UTF-8 becomes its text, and drops the bytes");
        string Failure(byte[] data, bool isBmp)
        {
            try { if (isBmp) ImageDecode.Bmp(data, out _, out _); else ImageDecode.Gif(data, out _, out _); }
            catch (Exception e) { return e.Message; }
            throw new InvalidOperationException("corrupt decoder fixture succeeded");
        }
        check(Reply(Pictures.ReadBytes([66, 77])).Meta.Error == Failure([66, 77], true)
            && Reply(Pictures.ReadBytes(Encoding.ASCII.GetBytes("GIF89a"))).Meta.Error == Failure(Encoding.ASCII.GetBytes("GIF89a"), false), "picture: corrupt managed formats return the mod's failures");
        Pictures.Set("https://example.com/bad-size.png", -1, 2, null);
        check(Draw(src: "https://example.com/bad-size.png").Problems.Any(p => p.Message.EndsWith("the image could not be decoded")), "picture: invalid supplied dimensions report decoding failure");

        Pictures.Set(Source, 4, 2, null);
        var frame = Draw("fit=cover");
        var bytes = FrameWriter.Write(frame);
        check(Encoding.ASCII.GetString(bytes, 0, 4) == "VBF3", "picture: frames use VBF3");
        var jsonSize = BitConverter.ToInt32(bytes, 16);
        var json = JsonDocument.Parse(bytes.AsMemory(bytes.Length - jsonSize)).RootElement;
        check(json.TryGetProperty("images", out var images) && images.GetArrayLength() == 1
            && json.TryGetProperty("pending", out var waiting) && waiting.GetArrayLength() == 0, "picture: VBF3 JSON carries image ranges and pending");
        if (Encoding.ASCII.GetString(bytes, 0, 4) == "VBF3")
        {
            var uv = MemoryMarshal.Cast<byte, float>(bytes.AsSpan(20 + 16 * (frame.Positions.Length / 2), frame.Uv.Length * 4)).ToArray();
            check(uv.SequenceEqual(frame.Uv), "picture: VBF3 UV section round trip");
        }
        else check(false, "picture: VBF3 UV section round trip");
        var bin = Path.Combine(Fixtures.Root, "fixtures", "frames", "picture.bin");
        if (Fixtures.Write) File.WriteAllBytes(bin, bytes);
        check(File.Exists(bin) && File.ReadAllBytes(bin).SequenceEqual(bytes), "picture: VBF3 sample fixture matches this build");
    }
}
