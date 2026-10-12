using System;
using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using ScriptedScreensVector;
using UnityEngine;

namespace VectorBuilder.Core;

/// <summary>A picture read's metadata: the format and size, or why it was not read.</summary>
/// <param name="Note">Why the preview does not show a picture the game would load (it needs more memory than the
/// preview's core has free); unlike an error, it does not report the picture as failed.</param>
public sealed record PictureResult(string? Format = null, int Width = 0, int Height = 0, string? Error = null, string? Note = null);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(PictureResult))]
internal sealed partial class PictureJson : JsonSerializerContext { }

/// <remarks>
/// A read replies in one binary block, so the pixels never travel as text: "VBP1", the metadata's length (int32,
/// little-endian), the metadata as JSON (UTF-8), then the payload. The payload is the file's own bytes for PNG and
/// JPEG, which the browser decodes, and RGBA for BMP and GIF, bottom row first as a WebGL texture takes it. It is
/// empty after an error or a note, and for PNG or JPEG bytes the page sent itself.
/// Each step that allocates in proportion to the picture first checks that it fits in the memory the core has free
/// (Free), and says so in a note when it does not. A read at the mod's size limit holds the file, the decoder's pixels
/// and the reply at once: 201 MB for a 4096×4096 32-bit BMP, in a heap the chip shares.
/// </remarks>
public static class Pictures
{
    public const int Header = 8;

    /// <summary>Kept back from Free: the runtime's own memory outside the collector's heap, and the gaps that large
    /// arrays leave between them.</summary>
    public const long Reserve = 64L << 20;

    /// <summary>What a read may still allocate: the heap cap as the collector reports it (the wasm build's
    /// EmccMaximumHeapSize) less what is live after a collection, and less Reserve. The collection also frees the
    /// previous read's arrays, which the collector would otherwise leave in place until the heap ran out.</summary>
    public static long Free()
    {
        GC.Collect();
        return GC.GetGCMemoryInfo().TotalAvailableMemoryBytes - GC.GetTotalMemory(false) - Reserve;
    }

    static long Mb(long bytes) => (Math.Max(bytes, 0) + (1 << 20) - 1) >> 20;

    /// <summary>A step needing less is not checked: Reserve covers it, and it skips the collection, which took 83-91 ms
    /// over the three steps of a small read beside a chip holding 300,000 small tables.</summary>
    public const long Small = 8L << 20;

    /// <summary>The note for a step that needs <paramref name="need"/> bytes when they do not fit, else null.</summary>
    public static string? TooLarge(long need, string step)
    {
        if (need < Small) return null;
        var free = Free();
        return need <= free ? null : $"too large to preview here: {step} needs about {Mb(need)} MB, and the preview's core has {Mb(free)} MB free";
    }

    // The backstop when an estimate fell short: the step's arrays are garbage once its frame has unwound.
    static PictureResult OutOfMemory(string step)
    {
        GC.Collect();
        return new(Note: $"too large to preview here: the preview's core ran out of memory {step}");
    }

    /// <summary>An array for a fetched picture's bytes, or null and why not.</summary>
    public static byte[]? Hold(int length, out string? note)
    {
        note = TooLarge(length, $"holding this {Mb(length)} MB picture");
        if (note != null) return null;
        try { return new byte[length]; }
        catch (OutOfMemoryException) { note = OutOfMemory("holding this picture").Note; return null; }
    }

    public static string Json(PictureResult result) => JsonSerializer.Serialize(result, PictureJson.Default.PictureResult);

    /// <summary>A reply of `meta` with room for `payload` bytes after it; the payload starts at `at`.</summary>
    public static byte[] Reply(PictureResult meta, int payload, out int at)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(meta, PictureJson.Default.PictureResult);
        var reply = new byte[checked(Header + json.Length + payload)];
        "VBP1"u8.CopyTo(reply);
        BinaryPrimitives.WriteInt32LittleEndian(reply.AsSpan(4), json.Length);
        json.CopyTo(reply, Header);
        at = Header + json.Length;
        return reply;
    }

    public static byte[] Reply(PictureResult meta) => Reply(meta, 0, out _);

    /// <summary>A data: URL the page sent as UTF-8, or null and why not. Drops the bytes once they are text, so that the
    /// collection before the next step frees them.</summary>
    public static string? Text(ref byte[]? utf8, out string? note)
    {
        var length = utf8?.Length ?? 0;
        note = TooLarge(2L * length, $"reading this data: URL of {length} bytes");
        if (note != null) return null;
        try
        {
            var text = Encoding.UTF8.GetString(utf8 ?? []);
            utf8 = null;
            return text;
        }
        catch (OutOfMemoryException) { utf8 = null; note = OutOfMemory("reading this data: URL").Note; return null; }
    }

    public static byte[] Read(string src)
    {
        byte[]? bytes;
        if (src.StartsWith(ImageCache.PointPrefix, StringComparison.Ordinal)) src = src[ImageCache.PointPrefix.Length..];
        if (!src.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return Reply(new(Error: "the picture source is not a data: URL"));
        // DataUrl copies the body out of the URL (two bytes a character), then decodes it: base64 at most one byte a
        // character, percent-encoding through a List<byte> and its copy (two).
        var comma = src.IndexOf(',');
        if (comma > 0)
        {
            var base64 = src.AsSpan(0, comma).EndsWith(";base64", StringComparison.OrdinalIgnoreCase);
            var note = TooLarge((base64 ? 3L : 4L) * (src.Length - comma), $"reading this data: URL of {src.Length} characters");
            if (note != null) return Reply(new(Note: note));
        }
        try { bytes = ImageDecode.DataUrl(src); }
        catch (OutOfMemoryException) { return Reply(OutOfMemory("reading this data: URL")); }
        catch (Exception) { return Reply(new(Error: "unreadable data: URL")); }
        return bytes == null ? Reply(new(Error: "unreadable data: URL")) : ReadBytes(bytes);
    }

    /// <summary>`echo`: whether a PNG or JPEG reply carries the file back (the page already has the bytes it sent).</summary>
    public static byte[] ReadBytes(byte[] bytes, bool echo = true)
    {
        PictureResult meta;
        Color32[]? pixels;
        try
        {
            var format = ImageDecode.Sniff(bytes);
            if (format is ImageDecode.Format.Png or ImageDecode.Format.Jpeg)
            {
                var file = Reply(new(Format: format == ImageDecode.Format.Png ? "png" : "jpeg"), echo ? bytes.Length : 0, out var start);
                if (echo) bytes.CopyTo(file, start);
                return file;
            }
            if (format is not (ImageDecode.Format.Bmp or ImageDecode.Format.Gif))
                return Reply(new(Error: "not a PNG, JPEG, BMP or GIF"));
            var limit = DecodeLimit(bytes, format, out var need, out var size);
            if (limit != null) return Reply(new(Error: limit));
            var note = TooLarge(need, $"decoding this {size} picture");
            if (note != null) return Reply(new(Note: note));
            int width, height;
            pixels = format == ImageDecode.Format.Bmp ? ImageDecode.Bmp(bytes, out width, out height) : ImageDecode.Gif(bytes, out width, out height);
            meta = new(Format: format == ImageDecode.Format.Bmp ? "bmp" : "gif", Width: width, Height: height);
        }
        catch (OutOfMemoryException) { return Reply(OutOfMemory("decoding this picture")); }
        catch (Exception e) { return Reply(new(Error: e.Message)); }
        byte[] reply;
        try { reply = Reply(meta, checked(pixels.Length * 4), out _); }
        catch (OutOfMemoryException) { pixels = null; return Reply(OutOfMemory("decoding this picture")); }
        var first = reply.Length - pixels.Length * 4;
        var row = meta.Width * 4;
        for (var y = 0; y < meta.Height; y++)
            MemoryMarshal.AsBytes(pixels.AsSpan((meta.Height - 1 - y) * meta.Width, meta.Width)).CopyTo(reply.AsSpan(first + y * row, row));
        return reply;
    }

    // The decoder bounds the screen, but not an 8-bit BMP palette or a GIF image descriptor's allocation.
    // need: what decoding allocates. The screen's pixels and the reply, four bytes a pixel each; for a GIF also the
    // compressed data the decoder gathers (a List<byte> that grows by doubling: under three times the file while it
    // copies) and one index per descriptor pixel. A screen the decoder refuses needs nothing.
    static string? DecodeLimit(byte[] bytes, ImageDecode.Format format, out long need, out string dimensions)
    {
        int U16(int at) => BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(at, 2));
        int S32(int at) => BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(at, 4));
        var screen = "";
        long Screen(long w, long h)
        {
            screen = $"{w}×{h}";
            return w > 0 && h > 0 && w * h <= 16_777_216 ? 8 * w * h : 0;
        }
        need = 0;
        dimensions = "";
        if (format == ImageDecode.Format.Bmp)
        {
            if (bytes.Length >= 26) need = Screen(S32(18), Math.Abs((long)S32(22)));
            dimensions = screen;
            return bytes.Length >= 50 && S32(14) >= 40 && U16(28) == 8 && S32(46) > 256
                ? "too large: BMP palette exceeds 256 entries" : null;
        }
        if (bytes.Length < 13) return null; // Truncated input keeps the decoder's own failure message.
        need = Screen(U16(6), U16(8));
        dimensions = screen;
        if (need > 0) need += 3L * bytes.Length;
        var at = 13 + ((bytes[10] & 0x80) == 0 ? 0 : 3 * (2 << (bytes[10] & 7)));
        while (at < bytes.Length)
        {
            var block = bytes[at++];
            if (block == 0x2c)
            {
                if (bytes.Length - at < 9) return null;
                var indices = (long)U16(at + 4) * U16(at + 6);
                if (need > 0) need += indices;
                return indices > 16_777_216 ? "too large: GIF image exceeds 16777216 pixels" : null;
            }
            if (block != 0x21 || at == bytes.Length) return null;
            at++; // Extension label, then its length-prefixed sub-blocks.
            while (at < bytes.Length && bytes[at] != 0)
            {
                var size = bytes[at++];
                if (size > bytes.Length - at) return null;
                at += size;
            }
            if (at < bytes.Length) at++;
        }
        return null;
    }

    public static void Set(string src, int width, int height, string? error)
    {
        if (src.StartsWith(ImageCache.PointPrefix, StringComparison.Ordinal)) src = src[ImageCache.PointPrefix.Length..];
        if (error == null && (width <= 0 || height <= 0)) error = "the image could not be decoded";
        var entry = (error == null ? width : 0, error == null ? height : 0, error);
        ImageCache.Loaded[src] = entry;
        ImageCache.Loaded[ImageCache.PointPrefix + src] = entry;
    }
}
