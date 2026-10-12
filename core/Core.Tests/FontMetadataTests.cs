using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using VectorBuilder.Core;

static class FontMetadataTests
{
    public static void Run(Action<bool, string> check)
    {
        var names = Names((1, "Legacy SemiBold"), (2, "Regular"), (4, "Wrong Full Name"),
            (16, "Test Family"), (17, "SemiBold"), (256, "Weight"), (257, "Bold Italic"));
        var variable = Fvar();
        foreach (var font in new[] { Sfnt(names, variable), Woff(names, variable) })
        {
            var m = FontMetadata.Read(font);
            check(m.status == "ok" && m.family == "Test Family" && m.style == "SemiBold", "metadata prefers typographic names to legacy/full names in SFNT and WOFF2");
            check(m.axes is [{ tag: "wght", min: 100, @default: 400, max: 900 }] &&
                m.instances is [{ family: "Test Family", style: "Bold Italic" }] && m.instances[0].axes["wght"] == 700,
                "metadata named instances use their subfamilyNameID and signed Fixed coordinates");
        }
        var legacy = FontMetadata.Read(Sfnt(Names((1, "Legacy"), (2, "Oblique"))));
        check(legacy.status == "ok" && legacy.family == "Legacy" && legacy.style == "Oblique", "metadata falls back per field to IDs 1/2");
        check(FontMetadata.Read(Sfnt(Names((1, "Legacy"), (2, "Bold"), (16, "Typographic")))).style == "Bold", "metadata permits a partial typographic pair");
        check(FontMetadata.Read(Sfnt(Names((1, "Legacy"), (2, "")))).style == "", "metadata preserves an empty regular style");
        check(FontMetadata.Read(Sfnt(Names((1, "Family"), (2, " Bold Italic ")))).style == " Bold Italic ", "metadata preserves non-regular style names verbatim");
        check(FontMetadata.Read(Sfnt(Names((4, "Full only")))).status == "failed", "metadata fails missing family/style rather than inventing names");
        foreach (var fault in new[] { "surrogate", "odd length", "code page" })
        {
            var unrelated = Names((1, "Family"), (2, "Regular"), (10, "x"));
            Damage(unrelated, 2, fault);
            foreach (var font in new[] { Sfnt(unrelated), Woff(unrelated) })
            {
                var m = FontMetadata.Read(font);
                check(m.status == "ok" && m.family == "Family" && !m.names!.ContainsKey(10), "unused " + fault + " name record is not decoded in SFNT/WOFF2");
            }
            var fallback = Names((1, "x"), (1, "Family"), (2, "Regular"));
            Damage(fallback, 0, fault);
            foreach (var font in new[] { Sfnt(fallback), Woff(fallback) })
            {
                var m = FontMetadata.Read(font);
                check(m.status == "ok" && m.family == "Family" && System.Text.Json.JsonSerializer.Serialize(m).Contains("skipped name record 0 (ID 1)"),
                    "bad relevant " + fault + " record is skipped with a note and a valid alternate wins");
            }
        }
        var badTypographic = Names((1, "Legacy"), (2, "Regular"), (16, "x")); Damage(badTypographic, 2, "surrogate");
        check(FontMetadata.Read(Sfnt(badTypographic)).family == "Legacy", "bad typographic record falls back to a usable legacy name");
        var badInstance = Names((1, "Family"), (2, "Regular"), (256, "Weight"), (257, "x"), (257, "Bold")); Damage(badInstance, 3, "surrogate");
        check(FontMetadata.Read(Sfnt(badInstance, variable)).instances?[0].style == "Bold", "referenced fvar names decode lazily and skip a bad alternate");
        var broken = (byte[])names.Clone(); Put16(broken, 4, 65535);
        Invalid(Sfnt(broken), "name string offset beyond table");
        broken = (byte[])names.Clone(); Put16(broken, 2, 65535);
        Invalid(Sfnt(broken), "name record count beyond table");
        broken = (byte[])names.Clone(); Put16(broken, 14, 3);
        check(FontMetadata.Read(Sfnt(broken)).status == "ok", "bad unused legacy record does not reject usable typographic names");
        foreach (var (offset, value) in new[] { (4, 65535), (8, 65535), (10, 19), (12, 65535), (14, 7) })
        {
            broken = (byte[])variable.Clone(); Put16(broken, offset, value);
            Invalid(Sfnt(names, broken), "invalid fvar offset/count/record size " + offset);
        }
        broken = (byte[])variable.Clone(); Put16(broken, 36, 258);
        check(FontMetadata.Read(Sfnt(names, broken)).status == "failed", "missing instance name is an explicit metadata failure");
        broken = Sfnt(names); Put32(broken, 20, uint.MaxValue);
        Invalid(broken, "overflowing SFNT table offset");
        for (var n = 0; n < 48; n++) Invalid(Woff(names)[..n], "truncated WOFF2 header " + n);
        broken = Woff(names); broken[49] = 0x80;
        Invalid(broken, "Base128 leading zero");
        broken = Woff(names); Put32(broken, 20, uint.MaxValue);
        Invalid(broken, "compressed length exceeds input");
        broken = Woff(names); Put32(broken, 16, uint.MaxValue);
        check(FontMetadata.Read(broken).status == "ok", "WOFF2 totalSfntSize is advisory and never preallocated");
        Invalid(Woff(names, declaredExtra: 1), "Brotli output shorter than directory");
        Invalid(Woff(names, trailingOutput: true), "Brotli output exceeds directory");
        broken = Woff(names); Array.Fill(broken, (byte)0xff, broken.Length - 8, 8);
        Invalid(broken, "malformed Brotli stream");
        check(FontMetadata.Read(Woff(names), 32).status == "read-budget", "valid metadata over available memory is a read budget, not invalid");
        check(FontMetadata.Read(Sfnt(Names((1, new string('x', 1024)), (2, "Regular"))), 512).status == "read-budget",
            "SFNT decoded names also respect available runtime memory");
        check(FontMetadata.Read(Sfnt(Names((1, "Family"), (2, "Regular"), (256, new string('x', 1024)))), 1024).status == "ok",
            "unused names do not consume the decoded-name budget");
        var large = new byte[2_000_000]; names.CopyTo(large, 0);
        check(FontMetadata.Read(Woff(large)).status == "ok", "large compressible metadata streams without a font-size cap");
        check(FontMetadata.Read(Woff(large), 64 * 1024).status == "read-budget", "large valid Brotli output reaches the external allocation budget");
        var ttc = new byte[20 + Sfnt(names).Length]; "ttcf"u8.CopyTo(ttc); Put32(ttc, 4, 0x10000); Put32(ttc, 8, 1); Put32(ttc, 12, 20);
        Sfnt(names).CopyTo(ttc, 20); Put32(ttc, 40, 48);
        check(FontMetadata.Read(ttc).faces?.Length == 1, "SFNT collections use absolute table offsets");
        check(FontMetadata.Read(Woff(names, collection: true)).faces?.Length == 1, "WOFF2 collections decode indexed metadata tables");
        // WOFF2 5.5: in a single font other tables may sit between a transformed glyf and its loca; in a collection each
        // loca must immediately follow its glyf. Encoders that sort the directory by tag put head, hhea and hmtx between.
        check(FontMetadata.Read(WoffGlyf(names, between: true)).status == "ok", "WOFF2: a single font may put tables between transformed glyf and loca");
        check(FontMetadata.Read(WoffGlyf(names, between: false)).status == "ok", "WOFF2: transformed glyf immediately followed by loca");
        check(FontMetadata.Read(WoffGlyf(names, between: true, collection: true)).cause == "invalid font metadata: transformed glyf/loca pair",
            "WOFF2 collections still need each loca immediately after its glyf");
        check(FontMetadata.Read(WoffGlyf(names, between: true, loca: false)).cause == "invalid font metadata: transformed glyf/loca pair",
            "WOFF2: a transformed glyf without a transformed loca is refused");
        var fonts = Path.Combine(Fixtures.Root, "..", "public", "fonts");
        var bundled = Directory.GetFiles(fonts, "*.woff2").OrderBy(f => f, StringComparer.Ordinal).ToArray();
        var read = bundled.Select(f => (file: Path.GetFileNameWithoutExtension(f), m: FontMetadata.Read(File.ReadAllBytes(f)))).ToArray();
        var unread = read.Where(r => r.m.status != "ok").Select(r => $"{r.file}: {r.m.cause}").ToArray();
        check(bundled.Length > 0 && unread.Length == 0, $"every bundled WOFF2 face gives its metadata ({bundled.Length} files; unread: {string.Join("; ", unread.Take(3))})");
        check(read.All(r => r.m.status != "ok" || r.m.family == (r.file.StartsWith("LiberationSans") ? "Liberation Sans" : r.file.StartsWith("BarlowCondensed") ? "Barlow Condensed" : r.file.StartsWith("JetBrainsMono") ? "JetBrains Mono" : "Barlow")),
            "bundled WOFF2 faces name their own family: " + string.Join(", ", read.Select(r => $"{r.file}={r.m.family}/{r.m.style}").Take(4)));
        var otf = Sfnt(names); Put32(otf, 0, 0x4f54544f);
        check(FontMetadata.Read(otf).status == "ok", "OTF shares the SFNT metadata reader");
        foreach (var encoding in new[] { 0, 1, 2, 6, 10 })
        {
            var unicode = Names((1, "日本語"), (2, "Regular")); Put16(unicode, 8, encoding);
            check(FontMetadata.Read(Sfnt(unicode)).family == "日本語", "Windows name encoding " + encoding + " is UTF16 except the specified PRC/Big5/Wansung encodings");
        }
        var locale = Names((1, "Other"), (1, "English"), (2, "Regular")); Put16(locale, 10, 0x411);
        check(FontMetadata.Read(Sfnt(locale)).family == "English", "Windows English beats an earlier localized record");
        var format1 = Names((1, "English"), (2, "Regular")); var extended = new byte[format1.Length + 10];
        format1[..30].CopyTo(extended, 0); format1[30..].CopyTo(extended, 36); Put16(extended, 0, 1); Put16(extended, 4, 36);
        Put16(extended, 10, 0x8000); Put16(extended, 22, 0x8000); Put16(extended, 30, 1); Put16(extended, 32, 4);
        Put16(extended, 34, format1.Length - 30); Encoding.BigEndianUnicode.GetBytes("en").CopyTo(extended, extended.Length - 4);
        check(FontMetadata.Read(Sfnt(extended)).family == "English", "name format 1 supports language tag records");
        var manyLanguages = new byte[format1.Length + 4006]; format1[..30].CopyTo(manyLanguages, 0); format1[30..].CopyTo(manyLanguages, 4032);
        Put16(manyLanguages, 0, 1); Put16(manyLanguages, 4, 4032); Put16(manyLanguages, 30, 1000);
        for (var i = 0; i < 1000; i++) { Put16(manyLanguages, 32 + 4 * i, 4); Put16(manyLanguages, 34 + 4 * i, format1.Length - 30); }
        Encoding.BigEndianUnicode.GetBytes("en").CopyTo(manyLanguages, manyLanguages.Length - 4);
        check(FontMetadata.Read(Sfnt(manyLanguages), 4096).status == "ok", "unused language tags are not decoded");
        var longLanguage = new byte[extended.Length + 1996]; extended[..^4].CopyTo(longLanguage, 0); Put16(longLanguage, 32, 2000);
        Encoding.BigEndianUnicode.GetBytes("en" + new string('x', 998)).CopyTo(longLanguage, extended.Length - 4);
        check(FontMetadata.Read(Sfnt(longLanguage), 4096).status == "read-budget", "referenced language tags respect available runtime memory");
        var roman = new byte[43]; Put16(roman, 2, 2); Put16(roman, 4, 30);
        for (var i = 0; i < 2; i++) { Put16(roman, 6 + 12 * i, 1); Put16(roman, 12 + 12 * i, i + 1); Put16(roman, 14 + 12 * i, i == 0 ? 6 : 7); Put16(roman, 16 + 12 * i, i == 0 ? 0 : 6); }
        new byte[] { 67, 97, 102, 142, 32, 88 }.CopyTo(roman, 30); Encoding.ASCII.GetBytes("Regular").CopyTo(roman, 36);
        check(FontMetadata.Read(Sfnt(roman)).family == "Café X", "Mac Roman records decode their actual encoding");
        var signed = (byte[])variable.Clone(); Put32(signed, 20, unchecked((uint)(-900 << 16))); Put32(signed, 24, 0); Put32(signed, 40, unchecked((uint)(-100 << 16)));
        check(FontMetadata.Read(Sfnt(names, signed)).instances?[0].axes["wght"] == -100, "fvar uses signed Fixed coordinates");
        foreach (var (family, count, memory) in new[] { (new string('x', 1000), 20, 40000), (new string('日', 64), 5, 8000) })
        {
            var repeated = Fvar(count);
            var shortNames = Names((1, "Family"), (2, "Regular"), (256, "Weight"), (257, "Bold"));
            var longNames = Names((1, family), (2, "Regular"), (256, "Weight"), (257, "Bold"));
            check(FontMetadata.Read(Sfnt(shortNames, repeated), memory).status == "ok", "short family instances fit the same external budget");
            check(FontMetadata.Read(Sfnt(longNames, repeated), memory).status == "read-budget", "instance budget counts repeated family text including JSON escapes");
            var longStyles = Names((1, "Family"), (2, "Regular"), (256, "Weight"), (257, family));
            check(FontMetadata.Read(Sfnt(longStyles, repeated), memory).status == "read-budget", "instance budget counts repeated style text including JSON escapes");
        }

        void Invalid(byte[] bytes, string why) => check(FontMetadata.Read(bytes).status == "invalid", "metadata rejects " + why);
    }

    static void Damage(byte[] names, int record, string fault)
    {
        var at = 6 + 12 * record;
        var text = BinaryPrimitives.ReadUInt16BigEndian(names.AsSpan(4)) + BinaryPrimitives.ReadUInt16BigEndian(names.AsSpan(at + 10));
        if (fault == "surrogate") Put16(names, text, 0xd800);
        else { Put16(names, at + 8, 1); if (fault == "code page") { Put16(names, at + 2, 3); names[text] = 0x81; } }
    }

    internal static byte[] Names(params (int id, string value)[] names)
    {
        var strings = names.Select(n => Encoding.BigEndianUnicode.GetBytes(n.value)).ToArray();
        var start = 6 + 12 * names.Length; var b = new byte[start + strings.Sum(s => s.Length)];
        Put16(b, 2, names.Length); Put16(b, 4, start); var at = 0;
        for (var i = 0; i < names.Length; i++)
        {
            var r = 6 + 12 * i; Put16(b, r, 3); Put16(b, r + 2, 1); Put16(b, r + 4, 0x409);
            Put16(b, r + 6, names[i].id); Put16(b, r + 8, strings[i].Length); Put16(b, r + 10, at);
            strings[i].CopyTo(b, start + at); at += strings[i].Length;
        }
        return b;
    }

    static byte[] Fvar(int instanceCount = 1)
    {
        var b = new byte[36 + 8 * instanceCount]; Put16(b, 0, 1); Put16(b, 4, 16); Put16(b, 6, 2); Put16(b, 8, 1);
        Put16(b, 10, 20); Put16(b, 12, instanceCount); Put16(b, 14, 8); "wght"u8.CopyTo(b.AsSpan(16));
        Put32(b, 20, 100 << 16); Put32(b, 24, 400 << 16); Put32(b, 28, 900 << 16); Put16(b, 34, 256);
        for (var i = 0; i < instanceCount; i++) { Put16(b, 36 + 8 * i, 257); Put32(b, 40 + 8 * i, 700 << 16); }
        return b;
    }

    internal static byte[] Sfnt(byte[] names, byte[]? fvar = null)
    {
        var start = fvar == null ? 28 : 44; var b = new byte[start + names.Length + (fvar?.Length ?? 0)];
        Put32(b, 0, 0x10000); Put16(b, 4, fvar == null ? 1 : 2); "name"u8.CopyTo(b.AsSpan(12));
        Put32(b, 20, (uint)start); Put32(b, 24, (uint)names.Length); names.CopyTo(b, start);
        if (fvar != null) { "fvar"u8.CopyTo(b.AsSpan(28)); Put32(b, 36, (uint)(start + names.Length)); Put32(b, 40, (uint)fvar.Length); fvar.CopyTo(b, start + names.Length); }
        return b;
    }

    internal static byte[] Woff(byte[] names, byte[]? fvar = null, int declaredExtra = 0, bool trailingOutput = false, bool collection = false)
    {
        using var dir = new MemoryStream(); dir.WriteByte(5); Base128(dir, (uint)(names.Length + declaredExtra));
        if (fvar != null) { dir.WriteByte(47); Base128(dir, (uint)fvar.Length); }
        if (collection) { dir.Write(new byte[] { 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0 }); }
        using var compressed = new MemoryStream();
        using (var br = new BrotliStream(compressed, CompressionLevel.SmallestSize, true))
        { br.Write(names); if (fvar != null) br.Write(fvar); if (trailingOutput) br.WriteByte(0); }
        var b = new byte[48 + dir.Length + compressed.Length]; "wOF2"u8.CopyTo(b); Put32(b, 4, collection ? 0x74746366u : 0x10000);
        Put32(b, 8, (uint)b.Length); Put16(b, 12, fvar == null ? 1 : 2); Put32(b, 16, (uint)names.Length);
        Put32(b, 20, (uint)compressed.Length); dir.ToArray().CopyTo(b, 48); compressed.ToArray().CopyTo(b, 48 + (int)dir.Length); return b;
    }

    /// <summary>A WOFF2 whose directory holds name, a transformed glyf, optionally hhea between, then a transformed loca.</summary>
    static byte[] WoffGlyf(byte[] names, bool between, bool collection = false, bool loca = true)
    {
        byte[] glyf = [1, 2, 3, 4, 5, 6, 7, 8], hhea = [9, 10, 11, 12];
        using var dir = new MemoryStream();
        dir.WriteByte(5); Base128(dir, (uint)names.Length);
        dir.WriteByte(10); Base128(dir, 100); Base128(dir, (uint)glyf.Length);   // glyf, transform 0: orig, then transformed length
        if (between) { dir.WriteByte(2); Base128(dir, (uint)hhea.Length); }
        if (loca) { dir.WriteByte(11); Base128(dir, 20); Base128(dir, 0); }       // loca, transform 0: orig, then length 0
        if (!between) { dir.WriteByte(2); Base128(dir, (uint)hhea.Length); }
        var count = loca ? 4 : 3;
        if (collection) { dir.Write([0, 1, 0, 0, 1, (byte)count, 0, 1, 0, 0]); for (var i = 0; i < count; i++) dir.WriteByte((byte)i); }
        using var compressed = new MemoryStream();
        using (var br = new BrotliStream(compressed, CompressionLevel.SmallestSize, true))
        { br.Write(names); br.Write(glyf); br.Write(hhea); }
        var b = new byte[48 + dir.Length + compressed.Length]; "wOF2"u8.CopyTo(b); Put32(b, 4, collection ? 0x74746366u : 0x10000);
        Put32(b, 8, (uint)b.Length); Put16(b, 12, count); Put32(b, 16, (uint)(names.Length + 100 + hhea.Length + 20));
        Put32(b, 20, (uint)compressed.Length); dir.ToArray().CopyTo(b, 48); compressed.ToArray().CopyTo(b, 48 + (int)dir.Length); return b;
    }

    static void Base128(Stream s, uint n)
    {
        var bytes = new List<byte> { (byte)(n & 127) }; while ((n >>= 7) != 0) bytes.Add((byte)(128 | (n & 127)));
        bytes.Reverse(); s.Write(bytes.ToArray());
    }
    internal static void Put16(byte[] b, int at, int n) => BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(at), (ushort)n);
    internal static void Put32(byte[] b, int at, uint n) => BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(at), n);
}
