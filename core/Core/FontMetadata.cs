// Metadata only, from the W3C WOFF2 and OpenType name/fvar specifications; no glyph reconstruction.
// https://www.w3.org/TR/WOFF2/  https://learn.microsoft.com/en-us/typography/opentype/spec/name
// https://learn.microsoft.com/en-us/typography/opentype/spec/fvar
using System;
using System.Buffers;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace VectorBuilder.Core;

public sealed record FontAxis(string tag, double min, double @default, double max, string name);
public sealed record FontInstance(string family, string style, Dictionary<string, double> axes);
public sealed record FontFaceMetadata(string family, string style, Dictionary<int, string> names, FontAxis[] axes, FontInstance[] instances);
public sealed record MetadataResult(string status, string? cause = null, string? family = null, string? style = null,
    Dictionary<int, string>? names = null, FontAxis[]? axes = null, FontInstance[]? instances = null, FontFaceMetadata[]? faces = null, string[]? notes = null);

public static class FontMetadata
{
    const long WasmHeap = 536870912;
    const string MissingNames = "cannot determine game face names from this served file";
    static readonly Encoding Utf16 = new UnicodeEncoding(true, false, true);
    static readonly string[] Tags = ("cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT " +
        "EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL " +
        "SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill")
        .Replace('_', ' ').Split(' ', StringSplitOptions.RemoveEmptyEntries);

    sealed class Budget : Exception { }
    sealed class Missing : Exception { }
    readonly record struct Table(string Tag, long Length, ReadOnlyMemory<byte> Data);

    public static MetadataResult Read(byte[] data) => Read(data, AvailableMemory());

    // Also used by tests to exercise a real external memory budget without exhausting the test process.
    internal static MetadataResult Read(byte[] data, long availableMemory)
    {
        var notes = new List<string>();
        try
        {
            var r = new Reader(data);
            var tables = r.U32(0) == 0x774f4632 ? Woff(r, availableMemory) : Sfnt(r);
            var budget = availableMemory / 4;
            var faces = tables.Select(t => ReadFace(t, notes, ref budget)).ToArray();
            if (faces.Length == 0) throw new InvalidDataException("empty font collection");
            var first = faces[0];
            return new("ok", family: first.family, style: first.style, names: first.names, axes: first.axes, instances: first.instances, faces: faces, notes: notes.Count == 0 ? null : notes.ToArray());
        }
        catch (Missing) { return new("failed", MissingNames, notes: notes.Count == 0 ? null : notes.ToArray()); }
        catch (Budget) { return new("read-budget", "too large to read names from here: available runtime memory"); }
        catch (OutOfMemoryException) { return new("read-budget", "too large to read names from here: runtime allocation failed"); }
        catch (Exception e) when (e is InvalidDataException or OverflowException or DecoderFallbackException or ArgumentException)
        { return new("invalid", "invalid font metadata: " + e.Message); }
    }

    static long AvailableMemory()
    {
        var total = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;
        return Math.Max(0, Math.Min(WasmHeap, total > 0 ? total : WasmHeap) - GC.GetTotalMemory(false));
    }

    sealed class Reader(ReadOnlyMemory<byte> data)
    {
        public int Length => data.Length;
        public ReadOnlyMemory<byte> Slice(long at, long length)
        {
            if (at < 0 || length < 0 || at > Length || length > Length - at) throw new InvalidDataException("table/record outside input");
            return data.Slice((int)at, (int)length);
        }
        public byte U8(long at) => Slice(at, 1).Span[0];
        public ushort U16(long at) => BinaryPrimitives.ReadUInt16BigEndian(Slice(at, 2).Span);
        public uint U32(long at) => BinaryPrimitives.ReadUInt32BigEndian(Slice(at, 4).Span);
        public double Fixed(long at) => unchecked((int)U32(at)) / 65536.0;
        public string Tag(long at)
        {
            var bytes = Slice(at, 4).Span;
            foreach (var b in bytes) if (b < 32 || b > 126) throw new InvalidDataException("invalid table/axis tag");
            return Encoding.ASCII.GetString(bytes);
        }
    }

    static bool Flavor(uint v) => v is 0x10000 or 0x4f54544f or 0x74727565 or 0x74797031;
    static List<Table[]> Sfnt(Reader r)
    {
        var offsets = new List<long>();
        if (r.U32(0) == 0x74746366)
        {
            var version = r.U32(4); if (version is not (0x10000 or 0x20000)) throw new InvalidDataException("TTC version");
            var count = r.U32(8); r.Slice(12, 4L * count);
            if (version == 0x20000) r.Slice(12 + 4L * count, 12);
            for (long i = 0; i < count; i++) offsets.Add(r.U32(12 + 4 * i));
        }
        else offsets.Add(0);
        var fonts = new List<Table[]>();
        foreach (var offset in offsets)
        {
            if (!Flavor(r.U32(offset))) throw new InvalidDataException("unsupported SFNT flavor");
            var count = r.U16(offset + 4); r.Slice(offset, 12 + 16L * count);
            var tables = new List<Table>(); var tags = new HashSet<string>(); var ranges = new List<(long start, long end)>();
            for (var i = 0; i < count; i++)
            {
                var at = offset + 12 + 16L * i; var tag = r.Tag(at); var start = r.U32(at + 8); var length = r.U32(at + 12);
                if (!tags.Add(tag)) throw new InvalidDataException("duplicate SFNT table");
                var bytes = r.Slice(start, length);
                if (length > 0) ranges.Add((start, start + (long)length));
                if (tag is "name" or "fvar") tables.Add(new(tag, length, bytes));
            }
            ranges.Sort((a, b) => a.start.CompareTo(b.start));
            for (var i = 1; i < ranges.Count; i++) if (ranges[i].start < ranges[i - 1].end) throw new InvalidDataException("overlapping SFNT tables");
            fonts.Add(tables.ToArray());
        }
        return fonts;
    }

    static uint Base128(Reader r, ref long at)
    {
        uint value = 0;
        for (var i = 0; i < 5; i++)
        {
            var b = r.U8(at++);
            if (i == 0 && b == 128 || (value & 0xfe000000) != 0) throw new InvalidDataException("invalid Base128");
            value = value << 7 | (uint)(b & 127);
            if ((b & 128) == 0) return value;
        }
        throw new InvalidDataException("overlong Base128");
    }

    static int UInt255(Reader r, ref long at)
    {
        var b = r.U8(at++);
        if (b == 253) { var n = r.U16(at); at += 2; return n; }
        return b == 254 ? r.U8(at++) + 506 : b == 255 ? r.U8(at++) + 253 : b;
    }

    static List<Table[]> Woff(Reader r, long available)
    {
        r.Slice(0, 48);
        if (r.U32(8) != r.Length) throw new InvalidDataException("WOFF2 file length");
        var flavor = r.U32(4);
        if (!Flavor(flavor) && flavor != 0x74746366) throw new InvalidDataException("WOFF2 flavor");
        var count = r.U16(12); if (count == 0) throw new InvalidDataException("empty WOFF2 directory");
        var tables = new Table[count]; var transformed = new bool[count]; long at = 48;
        for (var i = 0; i < count; i++)
        {
            var flags = r.U8(at++); var index = flags & 63; var tag = index == 63 ? r.Tag(at) : Tags[index].PadRight(4);
            if (index == 63) at += 4;
            var version = flags >> 6;
            var isTransform = tag is "glyf" or "loca" ? version != 3 : version != 0;
            if (tag is "glyf" or "loca" ? version is not (0 or 3) : tag == "hmtx" ? version > 1 : version != 0)
                throw new InvalidDataException("unknown WOFF2 transform");
            var original = Base128(r, ref at); var length = isTransform ? Base128(r, ref at) : original;
            if (tag == "loca" && isTransform && length != 0) throw new InvalidDataException("transformed loca length");
            transformed[i] = isTransform; tables[i] = new(tag, length, default);
        }
        // WOFF2 5.5: the loca table follows its glyf. A single font may hold other tables between them (encoders that sort
        // the directory by tag put head, hhea and hmtx there); in a collection each loca immediately follows its glyf.
        var single = flavor != 0x74746366;
        bool Transformed(int j, string tag) => tables[j].Tag == tag && transformed[j];
        for (var i = 0; i < count; i++)
        {
            if (Transformed(i, "glyf") && !(single ? Enumerable.Range(i + 1, count - i - 1).Any(j => Transformed(j, "loca")) : i + 1 < count && Transformed(i + 1, "loca")))
                throw new InvalidDataException("transformed glyf/loca pair");
            if (Transformed(i, "loca") && !(single ? Enumerable.Range(0, i).Any(j => Transformed(j, "glyf")) : i > 0 && Transformed(i - 1, "glyf")))
                throw new InvalidDataException("transformed loca/glyf pair");
        }
        var fonts = new List<int[]>();
        if (flavor == 0x74746366)
        {
            var version = r.U32(at); at += 4;
            if (version is not (0x10000 or 0x20000)) throw new InvalidDataException("WOFF2 collection version");
            var fontCount = UInt255(r, ref at);
            for (var f = 0; f < fontCount; f++)
            {
                var n = UInt255(r, ref at); if (!Flavor(r.U32(at))) throw new InvalidDataException("WOFF2 collection flavor"); at += 4;
                var indices = new int[n];
                for (var i = 0; i < n; i++) { indices[i] = UInt255(r, ref at); if (indices[i] >= count) throw new InvalidDataException("WOFF2 collection table index"); }
                fonts.Add(indices);
            }
        }
        else fonts.Add(Enumerable.Range(0, count).ToArray());
        foreach (var font in fonts)
            if (font.Select(i => tables[i].Tag).Distinct().Count() != font.Length) throw new InvalidDataException("duplicate WOFF2 font table");
        var compressed = r.Slice(at, r.U32(20));
        long end = at + compressed.Length;
        foreach (var (offset, size) in new[] { (r.U32(28), r.U32(32)), (r.U32(40), r.U32(44)) })
        {
            if (offset == 0) { if (size != 0) throw new InvalidDataException("WOFF2 optional block length"); continue; }
            if (size == 0 || offset != (end + 3 & ~3L)) throw new InvalidDataException("overlapping/misplaced WOFF2 optional block");
            foreach (var b in r.Slice(end, offset - end).Span) if (b != 0) throw new InvalidDataException("WOFF2 padding");
            r.Slice(offset, size); end = offset + (long)size;
        }
        if (end != r.Length)
        {
            if (r.Length != (end + 3 & ~3L)) throw new InvalidDataException("WOFF2 trailing bytes");
            foreach (var b in r.Slice(end, r.Length - end).Span) if (b != 0) throw new InvalidDataException("WOFF2 trailing padding");
        }
        // Retain only metadata; fourfold allowance covers stream growth, its copy, and parsed/serialized records.
        long retained = 0; var streams = new MemoryStream?[count];
        var scratch = new byte[32768]; var decoder = new MetadataBrotli(); var inputAt = 0; var tableIndex = 0; long tableAt = 0;
        try
        {
            while (true)
            {
                var status = decoder.Decompress(compressed.Span[inputAt..], scratch, out var consumed, out var written); inputAt += consumed;
                var outAt = 0;
                while (outAt < written)
                {
                    while (tableIndex < count && tableAt == tables[tableIndex].Length) { tableIndex++; tableAt = 0; }
                    if (tableIndex == count) throw new InvalidDataException("Brotli output exceeds directory");
                    var n = (int)Math.Min(written - outAt, tables[tableIndex].Length - tableAt);
                    if (tables[tableIndex].Tag is "name" or "fvar")
                    {
                        retained += n;
                        if (retained > available / 4) throw new Budget();
                        (streams[tableIndex] ??= new MemoryStream()).Write(scratch, outAt, n);
                    }
                    tableAt += n; outAt += n;
                }
                if (status == OperationStatus.Done)
                {
                    while (tableIndex < count && tableAt == tables[tableIndex].Length) { tableIndex++; tableAt = 0; }
                    if (tableIndex != count || inputAt != compressed.Length) throw new InvalidDataException("Brotli/directory length mismatch");
                    break;
                }
                if (status == OperationStatus.InvalidData || consumed == 0 && written == 0) throw new InvalidDataException("malformed/truncated Brotli stream");
            }
            for (var i = 0; i < count; i++) if (streams[i] != null) tables[i] = tables[i] with { Data = streams[i]!.ToArray() };
        }
        finally { decoder.Dispose(); foreach (var s in streams) s?.Dispose(); }
        return fonts.Select(font => font.Where(i => tables[i].Tag is "name" or "fvar").Select(i => tables[i]).ToArray()).ToList();
    }

    static FontFaceMetadata ReadFace(Table[] tables, List<string> notes, ref long budget)
    {
        var name = tables.FirstOrDefault(t => t.Tag == "name"); if (name.Tag == null) throw new Missing();
        var names = new NameTable(new Reader(name.Data), notes, ref budget);
        foreach (var id in new[] { 1, 2, 16, 17 }) names.Get(id, ref budget);
        var family = names.Get(16, ref budget) ?? names.Required(1, ref budget); var style = names.Get(17, ref budget) ?? names.Required(2, ref budget);
        if (family.Length == 0) throw new Missing();
        var axes = new List<FontAxis>(); var instances = new List<FontInstance>();
        var fvar = tables.FirstOrDefault(t => t.Tag == "fvar");
        if (fvar.Tag != null)
        {
            var r = new Reader(fvar.Data); r.Slice(0, 16);
            if (r.U16(0) != 1 || r.U16(2) != 0) throw new InvalidDataException("fvar version");
            var count = r.U16(8); var axisSize = r.U16(10); var instanceCount = r.U16(12); var instanceSize = r.U16(14); long at = r.U16(4);
            if (count != 0)
            {
                if (at < 16 || axisSize < 20 || instanceSize != 4L * count + 4 && instanceSize != 4L * count + 6)
                    throw new InvalidDataException("fvar offset/record size");
                r.Slice(at, (long)count * axisSize + (long)instanceCount * instanceSize);
                budget -= 64L * count + instanceCount * (64L + 64L * count);
                if (budget < 0) throw new Budget();
                var tags = new HashSet<string>();
                for (var i = 0; i < count; i++, at += axisSize)
                {
                    var tag = r.Tag(at); var min = r.Fixed(at + 4); var def = r.Fixed(at + 8); var max = r.Fixed(at + 12);
                    if (!tags.Add(tag) || min > def || def > max) throw new InvalidDataException("fvar axis range/tag");
                    axes.Add(new(tag, min, def, max, names.Required(r.U16(at + 18), ref budget)));
                }
                var familyBytes = JsonEncodedText.Encode(family).EncodedUtf8Bytes.Length;
                for (var i = 0; i < instanceCount; i++, at += instanceSize)
                {
                    var values = new Dictionary<string, double>();
                    for (var a = 0; a < count; a++)
                    {
                        var value = r.Fixed(at + 4 + 4L * a);
                        if (value < axes[a].min || value > axes[a].max) throw new InvalidDataException("fvar instance outside axis range");
                        values.Add(axes[a].tag, value);
                    }
                    if (instanceSize == 4L * count + 6) { var psName = r.U16(at + 4 + 4L * count); if (psName != 0xffff) names.Required(psName, ref budget); }
                    var instanceStyle = names.Required(r.U16(at), ref budget);
                    // Count each emitted JSON string, including escapes; the fourfold allowance covers output copies.
                    budget -= 2L * (familyBytes + JsonEncodedText.Encode(instanceStyle).EncodedUtf8Bytes.Length);
                    if (budget < 0) throw new Budget();
                    instances.Add(new(family, instanceStyle, values));
                }
            }
        }
        return new(family, style, names.Values, axes.ToArray(), instances.ToArray());
    }

    sealed class NameTable
    {
        readonly Reader r;
        readonly List<string> notes;
        readonly int storage, languageCount;
        readonly long languageStart;
        readonly Dictionary<int, List<int>> records = new();
        readonly Dictionary<int, string?> decoded = new(), languages = new();
        public Dictionary<int, string> Values { get; } = new();

        public NameTable(Reader r, List<string> notes, ref long budget)
        {
            this.r = r; this.notes = notes;
            var format = r.U16(0); var count = r.U16(2); storage = r.U16(4);
            if (format > 1) throw new InvalidDataException("name format");
            long recordsEnd = 6 + 12L * count; r.Slice(6, 12L * count);
            if (format == 1)
            {
                languageCount = r.U16(recordsEnd); languageStart = recordsEnd + 2; recordsEnd = languageStart + 4L * languageCount;
                r.Slice(languageStart, 4L * languageCount);
            }
            if (storage < recordsEnd || storage > r.Length) throw new InvalidDataException("name storage overlaps records");
            for (var i = 0; i < languageCount; i++) LanguageBytes(i);
            budget -= 32L * count;
            if (budget < 0) throw new Budget();
            for (var i = 0; i < count; i++)
            {
                long at = 6 + 12L * i; var id = r.U16(at + 6);
                r.Slice(storage + (long)r.U16(at + 10), r.U16(at + 8));
                if (!records.TryGetValue(id, out var list)) records[id] = list = new();
                list.Add(i);
            }
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        }

        public string Required(int id, ref long budget) => Get(id, ref budget) ?? throw new Missing();

        public string? Get(int id, ref long budget)
        {
            if (decoded.TryGetValue(id, out var cached)) return cached;
            string? best = null; var bestPriority = 4;
            foreach (var i in records.GetValueOrDefault(id) ?? [])
            {
                long at = 6 + 12L * i; var platform = r.U16(at); var encoding = r.U16(at + 2); var language = r.U16(at + 4);
                var unicode = platform == 0 && encoding <= 6 || platform == 3 && encoding is 0 or 1 or 2 or 6 or 10;
                var codePage = platform == 3 ? encoding switch { 3 => 936, 4 => 950, 5 => 949, _ => 0 } : platform == 1 && encoding == 0 ? 10000 : 0;
                if (!unicode && codePage == 0 || language >= 0x8000 && language - 0x8000 >= languageCount) continue;
                var english = language == 0x409;
                if (platform == 3 && unicode && language >= 0x8000)
                {
                    var tag = Language(language - 0x8000, ref budget);
                    if (tag == null) continue;
                    english = tag.StartsWith("en", StringComparison.OrdinalIgnoreCase);
                }
                // Provisional locale preference: Windows English, supported Unicode, Windows, then Mac.
                var priority = platform == 0 ? 1 : platform == 3 ? english ? 0 : 2 : 3;
                if (priority >= bestPriority) continue;
                var bytes = r.Slice(storage + (long)r.U16(at + 10), r.U16(at + 8));
                string text;
                try { text = unicode ? Unicode(bytes) : Encoding.GetEncoding(codePage, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback).GetString(bytes.Span); }
                catch (Exception e) when (e is DecoderFallbackException or InvalidDataException or ArgumentException)
                { Note($"skipped name record {i} (ID {id}): invalid encoded text", ref budget); continue; }
                budget -= 64L + 2L * text.Length - (best == null ? 0 : 64L + 2L * best.Length);
                if (budget < 0) throw new Budget();
                bestPriority = priority; best = text;
            }
            decoded[id] = best;
            if (best != null) Values[id] = best;
            return best;
        }

        ReadOnlyMemory<byte> LanguageBytes(int i) => r.Slice(storage + (long)r.U16(languageStart + 4L * i + 2), r.U16(languageStart + 4L * i));
        string? Language(int i, ref long budget)
        {
            if (languages.TryGetValue(i, out var cached)) return cached;
            string? tag = null;
            try { tag = Unicode(LanguageBytes(i)); }
            catch (Exception e) when (e is DecoderFallbackException or InvalidDataException)
            { Note($"skipped language record {i}: invalid UTF16 text", ref budget); }
            if (tag != null)
            {
                budget -= 64L + 2L * tag.Length;
                if (budget < 0) throw new Budget();
            }
            languages[i] = tag;
            return tag;
        }
        void Note(string text, ref long budget)
        {
            budget -= 64L + 2L * text.Length;
            if (budget < 0) throw new Budget();
            notes.Add(text);
        }
    }

    static string Unicode(ReadOnlyMemory<byte> bytes)
    {
        if (bytes.Length % 2 != 0) throw new InvalidDataException("odd UTF16 name length");
        return Utf16.GetString(bytes.Span);
    }

    // The browser runtime's managed Brotli assembly is a PNSE stub, but its installed native decoder is linked.
    // Use that decoder's public streaming C API in WASM; desktop tests use the standard managed API.
    sealed class MetadataBrotli : IDisposable
    {
        BrotliDecoder managed;
        readonly IntPtr native;
        public MetadataBrotli()
        {
            if (OperatingSystem.IsBrowser())
            {
                native = Create(IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (native == IntPtr.Zero) throw new OutOfMemoryException();
            }
        }
        public unsafe OperationStatus Decompress(ReadOnlySpan<byte> input, Span<byte> output, out int consumed, out int written)
        {
            if (!OperatingSystem.IsBrowser()) return managed.Decompress(input, output, out consumed, out written);
            nuint availableIn = (nuint)input.Length, availableOut = (nuint)output.Length;
            int result;
            fixed (byte* source = input, destination = output)
            {
                var nextIn = source; var nextOut = destination;
                result = Stream(native, ref availableIn, &nextIn, ref availableOut, &nextOut, out _);
            }
            if (result == 0 && ErrorCode(native) is <= -21 and >= -30) throw new OutOfMemoryException();
            consumed = input.Length - (int)availableIn; written = output.Length - (int)availableOut;
            return result switch { 1 => OperationStatus.Done, 2 => OperationStatus.NeedMoreData, 3 => OperationStatus.DestinationTooSmall, _ => OperationStatus.InvalidData };
        }
        public void Dispose() { if (native != IntPtr.Zero) Destroy(native); else managed.Dispose(); }
        [DllImport("libSystem.IO.Compression.Native", EntryPoint = "BrotliDecoderCreateInstance")]
        static extern IntPtr Create(IntPtr alloc, IntPtr free, IntPtr opaque);
        [DllImport("libSystem.IO.Compression.Native", EntryPoint = "BrotliDecoderDecompressStream")]
        static extern unsafe int Stream(IntPtr state, ref nuint availableIn, byte** nextIn, ref nuint availableOut, byte** nextOut, out nuint totalOut);
        [DllImport("libSystem.IO.Compression.Native", EntryPoint = "BrotliDecoderDestroyInstance")]
        static extern void Destroy(IntPtr state);
        [DllImport("libSystem.IO.Compression.Native", EntryPoint = "BrotliDecoderGetErrorCode")]
        static extern int ErrorCode(IntPtr state);
    }
}
