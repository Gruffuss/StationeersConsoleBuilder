using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using ScriptedScreensVector;
using VectorBuilder.Core;

/// <summary>
/// The mod as the oracle for the attribute catalogue (<c>web/src/schema/overlay.json</c>), in two checks per op.
/// Names: every key the overlay gives a node op, a def op or SCENE, written there, parses with no <c>unknown attribute</c>
/// problem (SceneModel.cs <c>Validate</c>, which exempts USE and SYM; it checks the defs too since 0.11.94, and the header and
/// a clip's shape since 0.11.96).
/// Scope: every key the overlay gives a node op or SCENE changes what the mod parses there: the node, or for a group
/// default on G or SCENE the children it passes down to. The key's requirement is written first, in the spelling that op
/// reads (on G and SCENE a stroke key needs s_, as index.ts says). <c>op</c>, <c>scene</c> and the arrays <c>c</c>,
/// <c>defs</c>, <c>root</c> are skipped (in src they are the line's head, the element's own prop and the blocks), as are
/// maps, gradient stops and USE's ref (it needs a symbol).
/// </summary>
static class SchemaTests
{
    const string Kids = "R x=0 y=0 w=4 h=4\nT x=0 y=0 w=4 h=4 text=a\nP d=\"M0 0 L4 0 L4 4 Z\"";

    public static void Run(Action<bool, string> check)
    {
        Repin(check);
        var dir = Path.Combine(Fixtures.Root, "..", "src", "schema");
        using var overlay = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, "overlay.json")));
        using var extracted = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, "extracted.json")));
        var nodeOps = extracted.RootElement.GetProperty("nodeOps").EnumerateArray().Select(o => o.GetString()!).ToArray();
        check(nodeOps.Length > 0, "schema: node ops found");
        var rows = overlay.RootElement.GetProperty("rows").EnumerateArray().ToArray();

        var defOps = extracted.RootElement.GetProperty("defOps").EnumerateArray().Select(o => o.GetString()!).Where(o => o != "SYM").ToArray();
        var unknown = nodeOps.Where(o => o != "USE").Concat(defOps).Append("SCENE").ToDictionary(o => o, _ => new List<string>());
        check(Parse("SCENE w=10 h=10\nDEFS {\nGL id=g nosuchkey=1\n}")?.Problems.Any(p => p.Contains("unknown attribute \"nosuchkey\"")) == true,
            "schema: the mod reports an unknown key on a def");

        // 0.11.96 reports what it used to drop in silence; traps.ts and validate.ts leave each of these to the mod.
        string[] Problems(string text) => Parse(text)?.Problems.ToArray() ?? ["no scene"];
        bool Says(string text, string part) => Problems(text).Any(p => p.Contains(part));
        var header = Problems("SCENE w=10 h=10 zzz=1 z_index=2 Visible=1 probe=1\nR w=1 h=1");
        check(header.Count(p => p.Contains("unknown attribute")) == 1 && header.Any(p => p.Contains("unknown attribute \"zzz\"")),
            $"schema: the mod reports an unknown key on the header and passes the host's keys there (traps.ts) {string.Join("; ", header)}");
        check(Says("SCENE w=10 h=10\nR w=1 h=1\nDEFS {\nCP id=c {\nR w=1 h=1 alsonot=1\n}\n}", "unknown attribute \"alsonot\""),
            "schema: the mod reports an unknown key on a clip's shape");
        check(Says("SCENE w=10 h=10\nR w=1 h=1\nDEFS {\nCP id=c {\nR w=1 h=1\nC rx=1\nY p=[0,0,1,0,1,1]\n}\n}", "2 further shapes were ignored")
              && Says("SCENE w=10 h=10\nR w=1 h=1\nDEFS {\nCP id=c {\nR w=1 h=1\nGL id=g\nSYM id=s {\nR w=1 h=1\n}\n}\n}", "a def belongs in DEFS, not inside a clip; 2 were ignored")
              && Says("SCENE w=10 h=10\nR w=1 h=1\nDEFS {\nCP id=c {\nGL id=g\nR w=1 h=1\n}\n}", "op \"GL\" is not supported")
              && Says("SCENE w=10 h=10\nR w=1 h=1\nDEFS {\nCP id=c {\nGL id=g\nR w=1 h=1\n}\n}", "a def belongs in DEFS, not inside a clip; 1 was ignored"),
            "schema: a clip reports its further shapes, and a def op before or after its shape (0.11.99; traps.ts clip-extra leaves both to it)");
        // An SC reads its scroll offset from its own map since 0.11.98 (traps.ts: its sov needs its own so): a so passed down,
        // from a G or the header, is not its offset (until 0.11.97 an SC with sov took it), and one of its own still is.
        string Offset(string text) => Parse(text)?.Root.SelectMany(n => n.Children.Prepend(n)).FirstOrDefault(n => n.Op == VecOp.Scroll)
            is { } sc ? sc.ScrollSet?.Evaluate(new EvalContext()).ToString(CultureInfo.InvariantCulture) ?? "none" : "no SC";
        var offsets = new[] { Offset("SCENE w=10 h=10\nG so=0.5 {\nSC id=l w=10 h=10 sov=1 {\nR w=1 h=1\n}\n}"),
            Offset("SCENE w=10 h=10 so=0.5\nSC id=l w=10 h=10 sov=1 {\nR w=1 h=1\n}"), Offset("SCENE w=10 h=10\nG so=0.5 {\nSC id=l w=10 h=10 so=0.25 sov=1 {\nR w=1 h=1\n}\n}") };
        check(offsets.SequenceEqual(["none", "none", "0.25"]), $"schema: an SC's scroll offset is its own so, never one passed down ({string.Join(", ", offsets)})");
        // A name in an expression takes a supplementary-plane character whole since 0.11.98, a letter or not (traps.ts and
        // validate.ts read names so); until 0.11.97 it was "expected a name".
        var astral = Problems("SCENE w=10 h=10\nR x=\"=$𝒳+1\" y=\"=$a😀b*2\" w=1 h=1 f=\"=mix(#000,#fff,$𝒳)\"");
        check(astral.Length == 0, $"schema: an expression reads a supplementary-plane name {string.Join("; ", astral)}".TrimEnd());
        // A first line's weight is bold (or 600 up), normal (or a lower number: it un-bolds a bold label's first line, drawn
        // by the game's text layer only) or reported since 0.11.98, so traps.ts says nothing of fl.
        check(Says("SCENE w=10 h=10\nT w=10 h=10 text=a fl=\"weight=heavy\"", "T fl: weight \"heavy\" is not bold, normal or a number")
              && Problems("SCENE w=10 h=10\nT w=10 h=10 text=a weight=bold fl=\"weight=normal\"\nT w=10 h=10 text=b fl=\"weight=500\"").Length == 0,
              "schema: an fl weight that is not bold, normal or a number is reported");
        // The clip's shape is parsed without its children (their queue is cleared before the root is parsed): nothing of
        // theirs is reported, an unknown key or a def op (traps.ts clip-extra); a G there has no usable shape.
        var shapeKids = Problems("SCENE w=10 h=10\nR w=1 h=1\nDEFS {\nCP id=c {\nR w=1 h=1 {\nR w=1 h=1 nokey=1\nGL id=g\n}\n}\nCP id=d {\nG {\nR w=1 h=1 nokey=1\n}\n}\n}");
        check(shapeKids is [var noShape] && noShape.Contains("clip \"d\" has no usable shape"),
              $"schema: the mod never reads a clip shape's children, and reports a G there as no usable shape {string.Join("; ", shapeKids)}");
        check(Says("SCENE w=10 h=10\nDEFS {\nGL id=g stops=[[0,#000],[1,#fff]]\n}\nG mask=g {\nR w=1 h=1\n}", "mask \"g\" is not a gradient reference")
              && Problems("SCENE w=10 h=10\nDEFS {\nGL id=g stops=[[0,#000],[1,#fff]]\n}\nG mask=\"\" {\nR w=1 h=1\n}").Length == 0,
            "schema: the mod reports a mask without @, and an empty mask is no mask");
        check(Says("SCENE w=10 h=10\nR w=1 h=1 sh=[0,0,2]", "3 given") && Says("SCENE w=10 h=10\nR w=1 h=1 sh=[0,0,2,0,bleu]", "\"bleu\" is not a colour")
              && Says("SCENE w=10 h=10\nR w=1 h=1 sh=[0,0,2,0,5]", "fifth field") && Says("SCENE w=10 h=10\nR w=1 h=1 sh=#000", "shadows are a list")
              && Problems("SCENE w=10 h=10\nDEFS {\nSYM id=s {\nR w=1 h=1\n}\n}\nUSE ref=s sh=4").Length == 0,
            "schema: the mod reports a malformed shadow (validate.ts), and a USE's sh is a parameter");
        check(Says("SCENE w=10 h=10\nR w=1 h=1 f=@g\nDEFS {\nGL id=g stops=[[0,#fff],[1,bleu]]\n}", "stop colour \"bleu\" is not a colour; dropped")
              && Says("SCENE w=10 h=10\nR w=1 h=1 f=@g\nDEFS {\nGL id=g stops=[[0,\"=#fff\"]]\n}", "stop colour \"=#fff\" is not a colour"),
            "schema: the mod reports a stop colour it drops (validate.ts)");
        check(Says("SCENE w=10 h=10\nR w=1 h=1 s=#fff sd=1 sdo=2", "unknown attribute \"sd\"") && Says("SCENE w=10 h=10\nR w=1 h=1 s=#fff sdo=2", "unknown attribute \"sdo\""),
            "schema: sd and sdo are unknown keys");
        var tried = 0;
        foreach (var row in rows)
        {
            var key = row.GetProperty("key").GetString()!;
            if (key is "op" or "c")
                continue;

            // A value of the key's kind: E or N 1, S x, P [1,1], NL [1,1,1,1]; each type has one kind, so the type decides.
            var sample = row.GetProperty("type").GetString() switch
            {
                "num" or "int" or "flag" => "1",
                "pair" => "[1,1]",
                "numlist" => "[1,1,1,1]",
                "stops" => "[[0,#fff]]",
                "shadow" => "[0,0,1,0,#000]",
                _ => "x",
            };
            foreach (var op in Ops(row).Where(unknown.ContainsKey))
            {
                if (op == "SCENE" && key is "scene" or "root" or "defs")   // the element's own prop and the blocks
                    continue;
                tried++;
                var text = defOps.Contains(op) ? $"SCENE w=10 h=10\nDEFS {{\n{op} id=d {key}={sample}\n}}"
                    : op == "SCENE" ? $"SCENE w=10 h=10 {key}={sample}\nR w=1 h=1" : $"SCENE w=10 h=10\n{op} {key}={sample}";
                var props = SceneText.ToProps(text, "s");
                var problems = props == null ? new[] { $"src rejected: {SceneText.Rejected}" } : SceneParser.Parse(props)?.Problems.ToArray() ?? new[] { "no scene" };
                if (problems.Any(p => p.Contains($"unknown attribute \"{key}\"") || p.StartsWith("src rejected") || p == "no scene"))
                    unknown[op].Add($"{key} ({string.Join("; ", problems)})");
            }
        }
        check(tried > 100, $"schema: {tried} overlay keys tried on their ops");
        foreach (var (op, keys) in unknown)
            check(keys.Count == 0, $"schema: every {op} key in the overlay is one the mod knows {string.Join(", ", keys)}".TrimEnd());

        // Scope. The oracle must tell a key that does something from one that does nothing.
        check(Describe(Parse(Text("R", ""))) == Describe(Parse(Text("R", ""))), "schema: a parsed scene describes the same twice");
        check(Effect("R", "seg", "3") == false && Effect("SP", "seg", "3") == true, "schema: the scope oracle sees seg work on SP and do nothing on R");
        check(Effect("T", "weight", "700") == true && Effect("T", "weight", "500") == false, "schema: weight takes a number, 600 and up bold");
        // An IMG reads a per-corner rx list since 0.11.98, as an R does (overlay.json: the rx row with the list note).
        check(Effect("IMG", "rx", "[2,2,2,2]") == true && Effect("R", "rx", "[2,2,2,2]") == true && Effect("C", "rx", "[2,2,2,2]") == false,
              "schema: an IMG and an R read a per-corner rx list, a C does not");
        var idle = nodeOps.Append("SCENE").ToDictionary(o => o, _ => new List<string>());
        foreach (var row in rows)
        {
            var key = row.GetProperty("key").GetString()!;
            var type = row.GetProperty("type").GetString()!;
            if (key is "op" or "scene" or "ref" || type is "map" or "array" or "stops")
                continue;
            var requires = row.TryGetProperty("requires", out var r) ? r.GetString() : null;
            var samples = Samples(key, type, row);
            foreach (var op in Ops(row).Where(idle.ContainsKey))
            {
                var need = requires == "s" && op is "G" or "SCENE" ? "s_" : requires;
                var context = need == null ? "" : Requirement.TryGetValue(need, out var v) ? $"{need}={v}" : null;
                if (context == null)
                    idle[op].Add($"{key} (no sample for its requirement {need})");
                else if (!samples.Any(s => Effect(op, key, s, context) == true))
                    idle[op].Add(key);
            }
        }
        foreach (var (op, keys) in idle)
            check(keys.Count == 0, $"schema: every {op} key in the overlay changes what the mod parses {string.Join(", ", keys)}".TrimEnd());

        // ParseStyle takes a group default by its exact key, lower case (GroupPaintDefaults is searched ordinally), so F= on
        // a G or the header is not passed down, while a shape reads its own F= (traps.ts default-case).
        bool Red(string src) => FrameTests.Draw(FrameTests.Src("SCENE w=10 h=10" + src), 10, 10).Colours.Chunk(4)
            .Any(c => c[0] == 255 && c[1] == 0 && c[2] == 0 && c[3] == 255);
        check(Red("\nG f=#ff0000 {\nR w=10 h=10\n}") && !Red("\nG F=#ff0000 {\nR w=10 h=10\n}")
              && Red(" f=#ff0000\nR w=10 h=10") && !Red(" F=#ff0000\nR w=10 h=10") && Red("\nR w=10 h=10 F=#ff0000"),
              "schema: a group default passes down only in lower case; a shape reads its own fill in any case");
        // Both spellings on one G: the lower-case one passes down in either order (parse.ts keeps a later exact default).
        check(Red("\nG F=#00ff00 f=#ff0000 {\nR w=10 h=10\n}") && Red("\nG f=#ff0000 F=#00ff00 {\nR w=10 h=10\n}"),
              "schema: a G's lower-case default passes down whether or not another spelling comes first");

        // The fmt specs web/test/fixtures/printf.json sorts for the trap warnings (traps.ts translate). Printf.ToNet hands
        // an unread spec back with %% collapsed; a read conversion comes back as a .NET format. This helper tests
        // string.Format itself; the scene's empty/default fmt is checked separately below.
        using var printf = JsonDocument.Parse(File.ReadAllText(Path.Combine(Fixtures.Root, "fixtures", "printf.json")));
        string[] Specs(string list) => printf.RootElement.GetProperty(list).EnumerateArray().Select(s => s.GetString()!).ToArray();
        var misread = Specs("unread").Concat(Specs("composite")).Where(s => Printf.ToNet(s) != s)
            .Concat(Specs("read").Where(s => Printf.ToNet(s) == s)).ToArray();
        check(Specs("read").Length > 0 && misread.Length == 0, $"schema: Printf reads exactly the fmt specs printf.json says {string.Join(" ", misread)}".TrimEnd());
        string Printed(string spec) => string.Format(CultureInfo.InvariantCulture, Printf.ToNet(spec), 1.5f);
        check(Specs("unread").All(s => Printed(s) == s) && Printed("") == "" && Printed("%.1f") == "1.5",
            "schema: an unread fmt prints as written, an empty one as nothing");

        // Drawn by the mod: a label bound to a number, whole and as a placeholder, at two values. A braced spec prints
        // what printf.json says (null: the missing text, --) whatever the number; a composite one prints the number.
        string Label(string spec, string text, float v) => FrameTests.Draw(FrameTests.Src(
            $"SCENE w=100 h=100\nT x=0 y=0 w=100 h=20 text=\"{text}\" fmt=\"{spec}\""), 100, 100,
            data: "{ v = " + v.ToString(CultureInfo.InvariantCulture) + " }").Text.SingleOrDefault()?.Text ?? "(no label)";
        (string Spec, string Printed)[] Braced(string map) => printf.RootElement.GetProperty(map).EnumerateObject()
            .Select(p => (Spec: p.Name, Printed: p.Value.ValueKind == JsonValueKind.Null ? "--" : p.Value.GetString()!)).ToArray();
        // formatted: a format item's own format (Z: none takes a number, the missing text; abc: no digit, its own text).
        // Drawn in a placeholder too, which since 0.11.101 formats as a whole binding does: a float, and where
        // string.Format refuses one, the number rounded to a long, else the missing text. At 0.11.99 it tried no long,
        // and before that a format a float refused failed the scene
        // ("could not be drawn").
        bool Splits(string spec) => Printf.TrySplit(Printf.ToNet(spec), out _, out _, out _);
        var braced = Braced("braced").Concat(Braced("formatted")).ToArray();
        var wrong = braced.Where(b => b.Spec.IndexOfAny(['"', '\\']) >= 0
                || new[] { 1.25f, 3.75f }.Any(v => Label(b.Spec, "$v", v) != b.Printed || Label(b.Spec, "<{$v}>", v) != "<" + b.Printed + ">"))
            .Select(b => $"{b.Spec} ({Label(b.Spec, "$v", 1.25f)}, {Label(b.Spec, "<{$v}>", 1.25f)})")
            .Concat(Specs("composite").Where(s => Label(s, "$v", 1.25f) == Label(s, "$v", 3.75f) || Label(s, "<{$v}>", 1.25f) == Label(s, "<{$v}>", 3.75f)))
            .ToArray();
        check(braced.Length > 0 && wrong.Length == 0 && Braced("formatted").Any(b => b.Printed == "--" && !Splits(b.Spec))
              && Braced("formatted").Any(b => b.Printed == "--" && Splits(b.Spec)),
            $"schema: a braced fmt prints what printf.json says in place of the number, a composite one prints the number {string.Join(" ", wrong)}".TrimEnd());
        // At 112, a fmt is reported if neither numeric route accepts it or it drops the number and looks like a
        // conversion (letters or a nonterminal %). Empty means default; punctuation-only literals are silent.
        // A report is found by the spec it quotes, including its printf translation in a placeholder.
        var reported = Specs("reported");
        var every = Specs("unread").Concat(Specs("composite")).Concat(Specs("read")).Concat(braced.Select(b => b.Spec)).Concat(Specs("integer")).Append("").ToArray();
        bool Reported(string text, string s) => Problems($"SCENE w=100 h=100\nT x=0 y=0 w=100 h=20 text=\"{text}\" fmt=\"{s}\"")
            .Any(p => p.Contains($"fmt \"{s}\"") || p.Contains($"fmt \"{Printf.ToNet(s)}\""));
        var wrongly = every.Where(s => Reported("$v", s) != reported.Contains(s) || Reported("<{$v}>", s) != reported.Contains(s))
            .Concat(reported.Where(s => !every.Contains(s))).Select(s => $"\"{s}\"").ToArray();
        check(reported.Length > 0 && wrongly.Length == 0,
            $"schema: the mod reports the fmt specs printf.json lists as reported, whole and in a placeholder, and no other it is held to {string.Join(" ", wrongly)}".TrimEnd());
        // Only formats used by numbers are checked; empty means default and punctuation-only literals are silent at 112.
        var scoped = (Literal: Problems("SCENE w=100 h=100\nT x=0 y=0 w=100 h=20 text=hello fmt=%q"),
            Own: Problems("SCENE w=100 h=100\nT x=0 y=0 w=100 h=20 text=\"<{$v:%q}>\""), Printed: Label("%.1f", "<{$v:%q}>", 1.25f));
        var bare = new[] { ("", "1.25"), ("%%", "%"), ("50%", "50%"), ("]", "]") }
            .Where(f => Label("%.1f", $"<{{$v:{f.Item1}}}>", 1.25f) != $"<{f.Item2}>"
                || Problems($"SCENE w=100 h=100\nT x=0 y=0 w=100 h=20 text=\"<{{$v:{f.Item1}}}>\"").Length != 0)
            .Select(f => $"\"{f}\"").ToArray();
        check(scoped.Literal.Length == 0 && scoped.Own is [var own] && own.Contains("fmt \"%q\"") && scoped.Printed == "<%q>" && bare.Length == 0,
            $"schema: the mod checks only a fmt a number goes through, a placeholder's own included ({string.Join("; ", scoped.Literal)} | {string.Join("; ", scoped.Own)} | {scoped.Printed} | {string.Join(" ", bare)})");
        // A placeholder's format follows the first ':' outside its index (0.11.97): a ']' in the format is literal, and the
        // node's fmt is not used (traps.ts formatsThroughFmt). It used to make the whole text the name, or drop the format.
        string Own(string text) => FrameTests.Draw(FrameTests.Src($"SCENE w=100 h=100\nT x=0 y=0 w=100 h=20 text=\"{text}\" fmt=\"%.0f\""), 100, 100,
            data: "{ v = 254.6, a = { 254.6 } }").Text.SingleOrDefault()?.Text ?? "(no label)";
        check(Own("<{$v:%.2f]}>") == "<254.60]>" && Own("<{$a[0]:%.2f]}>") == "<254.60]>" && Own("<{$a[0]}>") == "<255>",
            $"schema: a ']' in a placeholder's format is literal, and the placeholder keeps its format ({Own("<{$v:%.2f]}>")}, {Own("<{$a[0]:%.2f]}>")}, {Own("<{$a[0]}>")})");
        // p is read in x, y pairs, a last odd value dropped, an entry that is not a number (a nested list) read as 0, and a p
        // that is not a list as no point (Numbers, SceneModel.cs:2496-2508). A stroke drops a point within 0.01 of the one
        // before it, and a closed one its last where it meets its first (Stroke.Clean). An L, Y or SP with fewer than two
        // distinct points draws nothing, and a Y with two points only its stroke; an SP with two draws, closed too. A Y with
        // three points of which two are one draws no fill, but its shadow does (a blurred line, as for any three points in a
        // line), so traps.ts judges a Y's fill and shadow by the points written. None of it is reported (traps.ts p-odd,
        // p-few). Covered: the area of the triangles drawn with any alpha, so a zero-area fill is none.
        string Drawn(string node) => FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\n" + node), 100, 100) is var f
            ? $"{f.Indices.Length / 3}{(f.Problems.Length > 0 ? " " + string.Join("; ", f.Problems.Select(p => p.Message)) : "")}" : "";
        double Covered(string node)
        {
            var f = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\n" + node), 100, 100);
            var area = 0.0;
            for (var i = 0; i + 2 < f.Indices.Length; i += 3)
            {
                var (a, b, c) = (f.Indices[i], f.Indices[i + 1], f.Indices[i + 2]);
                if (f.Colours[4 * a + 3] + f.Colours[4 * b + 3] + f.Colours[4 * c + 3] > 0)
                    area += Math.Abs((f.Positions[2 * b] - f.Positions[2 * a]) * (f.Positions[2 * c + 1] - f.Positions[2 * a + 1])
                                     - (f.Positions[2 * c] - f.Positions[2 * a]) * (f.Positions[2 * b + 1] - f.Positions[2 * a + 1])) / 2;
            }
            return area;
        }
        bool Nothing(string node) => Covered(node) == 0 && !Drawn(node).Contains(' ');
        var points = new[] { Drawn("L p=[10,10,90,90,50] s=#fff sw=2") == Drawn("L p=[10,10,90,90] s=#fff sw=2"),
            Drawn("Y p=[10,10,90,10,90,90,5] f=#fff") == Drawn("Y p=[10,10,90,10,90,90] f=#fff"), Drawn("L p=[10,10,90,90] s=#fff sw=2") != "0",
            Drawn("L p=[10,10] s=#fff sw=2") == "0", Drawn("L s=#fff sw=2") == "0", Drawn("SP p=[10,10] s=#fff sw=2") == "0",
            Drawn("Y p=[10,10,90,10] f=#fff sh=[0,2,4,0,#000]") == "0", Drawn("Y p=[10,10,90,10] f=#fff s=#f00 sw=2") == Drawn("Y p=[10,10,90,10] s=#f00 sw=2"),
            Drawn("Y p=[10,10,90,10] s=#f00 sw=2") != "0", Drawn("SP p=[10,10,90,90] close=1 f=#fff") != "0", Drawn("Y p=[10,10,90,10,90,90,10,10] f=#fff") != "0",
            // points at one place; a Y whose three points are two (a repeat, or a last that meets its first)
            Nothing("L p=[10,10,10,10] s=#fff sw=2 f=#fff"), Nothing("L p=[10,10,10,10,10,10] s=#fff sw=2"), Nothing("SP p=[10,10,10,10] close=1 s=#fff sw=2 f=#fff"),
            Nothing("Y p=[10,10,10,10,10,10] s=#fff sw=2 f=#fff sh=[0,2,4,0,#000]"), Nothing("Y p=[10,10,90,10,10,10] f=#fff"),
            Nothing("Y p=[10,10,90,10,90,10] f=#fff"), !Nothing("Y p=[10,10,90,10,90,10] sh=[0,2,4,0,#000]"), !Nothing("Y p=[10,10,90,10,10,10] s=#fff sw=2"), !Nothing("Y p=[10,10,90,10,90,90,10,10] f=#fff"),
            !Nothing("L p=[10,10,10,10,90,90] s=#fff sw=2"), !Nothing("SP p=[10,10,10,10,90,90] s=#fff sw=2"),
            // a p that is not a list, and nested lists, each read as 0
            Nothing("L p=5 s=#fff sw=2"), Nothing("L p=[[10,10],[90,90]] s=#fff sw=2"),
            Covered("L p=[[10,10],[90,90],5,5] s=#fff sw=2") == Covered("L p=[0,0,5,5] s=#fff sw=2") && Covered("L p=[0,0,5,5] s=#fff sw=2") > 0,
            // upstream's own cases (seen on a console at 0.11.101): five values are a two-point line, three are one point
            Drawn("L p=[10,10,60,10,60] s=#fff sw=2") == Drawn("L p=[10,10,60,10] s=#fff sw=2"), Nothing("L p=[10,10,60] s=#fff sw=2"),
            // The minimum is per paint: a stroke takes two points, a fill three. An L with two fills nothing and strokes
            // its line; with three it fills. A Y with one point strokes nothing. An SP's points are its curve's samples, so
            // with two its fill passes that count but encloses nothing, open or closed (Stroke.Spline leaves a ring of two
            // open, so there is no sliver), and draws at most its feathered edge, a hairline (fea=0, or the two level or one
            // above the other: nothing); a closed one's shadow draws, as a blurred line; with three an SP fills. A fill
            // passed down from a group: an L fills it from three points, an L with two draws nothing of it and an SP with
            // two its feathered edge (traps.ts counts neither: provisional).
            Nothing("L p=[10,10,90,90] f=#fff"), Covered("L p=[10,10,90,90] f=#fff s=#f00 sw=2") == Covered("L p=[10,10,90,90] s=#f00 sw=2"),
            !Nothing("L p=[10,10,90,10,90,90] f=#fff"), Nothing("Y p=[10,10] s=#fff sw=2"),
            Covered("SP p=[10,10,90,90] f=#fff fea=0") == 0 && Covered("SP p=[10,10,90,90] close=1 f=#fff fea=0") == 0,
            Covered("SP p=[10,10,90,90] f=#fff") > 0 && Covered("SP p=[10,10,90,90] f=#fff") == Covered("SP p=[10,10,90,90] close=1 f=#fff"),
            !Nothing("SP p=[10,10,90,90] close=1 sh=[0,2,4,0,#000]"), !Nothing("SP p=[10,10,90,10,90,90] f=#fff"),
            Covered("SP p=[10,10,90,10] f=#fff") == 0 && Covered("SP p=[10,10,10,90] close=1 f=#fff") == 0,
            Covered("G f=#fff {\nL p=[10,10,90,10,90,90] s=#000 sw=2\n}") > Covered("L p=[10,10,90,10,90,90] s=#000 sw=2"),
            Covered("G f=#fff {\nL p=[10,10,90,90] s=#000 sw=2\n}") == Covered("L p=[10,10,90,90] s=#000 sw=2"),
            Covered("G f=#fff {\nSP p=[10,10,90,90] s=#000 sw=2\n}") > Covered("SP p=[10,10,90,90] s=#000 sw=2") };
        check(points.All(ok => ok), $"schema: p is read in pairs, and too few points draw nothing, without a report ({string.Join(" ", points.Select(ok => ok ? 1 : 0))})");
        // dash is read as a list (Numbers): a single number is no dash, the stroke solid, without a report (traps.ts literal-only).
        check(Covered("L p=[10,10,90,90] s=#fff sw=2 fea=0 dash=5") == Covered("L p=[10,10,90,90] s=#fff sw=2 fea=0") && !Drawn("L p=[10,10,90,90] s=#fff sw=2 fea=0 dash=5").Contains(' ')
              && Covered("L p=[10,10,90,90] s=#fff sw=2 fea=0 dash=[5,5]") < Covered("L p=[10,10,90,90] s=#fff sw=2 fea=0"),
            "schema: a number on dash draws the stroke solid, without a report");
        // D is a long's format: the whole binding prints the number rounded (FormatSlow's retry).
        check(Label("{0:D}", "$v", 1.25f) == "1" && Label("{0:D}", "$v", 3.75f) == "4", "schema: fmt {0:D} prints a whole binding's number as a long");
        // printf.json's integer specs: formats only a whole number takes. Since 0.11.101 a placeholder retries a format
        // string.Format refuses with a float with the number rounded to a long, as a whole binding does (AppendNumber,
        // Tessellator.cs:3301-3320; Format and FormatSlow, :3358-3439), so both print it, unreported. At 0.11.99 a
        // placeholder printed the missing text, and before that the scene failed.
        var integers = Specs("integer").Where(s => new[] { 1.25f, 3.75f }.Any(v => Label(s, "$v", v) == "--" || Label(s, "<{$v}>", v) != $"<{Label(s, "$v", v)}>"))
            .Select(s => $"{s} ({Label(s, "$v", 1.25f)}, {Label(s, "<{$v}>", 1.25f)})").ToArray();
        check(Specs("integer").Length > 0 && integers.Length == 0 && Label("{0:D3}", "<{$v}>", 1.25f) == "<001>",
            $"schema: a placeholder prints a format only a whole number takes as a whole binding does {string.Join(" ", integers)}".TrimEnd());
        // An X first: a placeholder prints as a whole binding does, its fmt one {0:X…} between braceless text or not. Since
        // 0.11.101 TextPart.Hex is set only where the fmt splits (TextNode.cs:361-367), and a format a float cannot take is
        // retried as a long (Tessellator.cs:3301-3320). None is reported. At 0.11.99 one that did not split (%x {0:D2})
        // cast the number to a long C# typed back as a float, and printed the missing text.
        string Hexed(string spec, string text) => FrameTests.Draw(FrameTests.Src(
            $"SCENE w=100 h=100\nT x=0 y=0 w=100 h=20 text=\"{text}\" fmt=\"{spec}\""), 100, 100, data: "{ v = 7.6 }") is var f
            ? (f.Text.SingleOrDefault()?.Text ?? "(no label)") + string.Concat(f.Problems.Select(p => "; " + p.Message)) : "";
        var hexed = new[] { ("%x {0:D2}", "8 08"), ("%x {0:F1}", "8 8.0"), ("%X {0:X}", "8 8"), ("%x", "8"), ("{0:X2}", "08") }
            .Select(h => (Spec: h.Item1, Want: h.Item2, Whole: Hexed(h.Item1, "$v"), Placed: Hexed(h.Item1, "<{$v}>"))).ToArray();
        check(hexed.All(h => h.Whole == h.Want && h.Placed == $"<{h.Want}>") && hexed.Count(h => !Splits(h.Spec)) == 3,
            $"schema: an X first formats a placeholder's number as a whole binding does, unreported {string.Join(" ", hexed.Select(h => $"{h.Spec}: {h.Whole}, {h.Placed}"))}");
        // A format with no digit: a negative number adds its minus sign (here even one that rounds to 0: -0.3 prints -abc;
        // .NET Framework 4.8 prints abc), so traps.ts claims it only where the number does not round to 0.
        var texts = Braced("formatted").Where(b => b.Printed != "--" && b.Spec.StartsWith("{0:")).ToArray();
        var unsigned = texts.Where(b => Label(b.Spec, "$v", -1.25f) != "-" + b.Printed || Label(b.Spec, "<{$v}>", -1.25f) != "<-" + b.Printed + ">")
            .Select(b => $"{b.Spec} ({Label(b.Spec, "$v", -1.25f)}, {Label(b.Spec, "<{$v}>", -1.25f)})").ToArray();
        check(texts.Length > 0 && unsigned.Length == 0,
            $"schema: a fmt with no digit prints its text with a negative number's minus sign {string.Join(" ", unsigned)}".TrimEnd());
        // With a width, the minus sign goes inside it (traps.ts names the width and says a negative number adds its sign).
        var signedWidths = new[] { ("{0,5:abc}", " -abc"), ("{0,-5:abc}|", "-abc |"), ("{0, 2:abc}", "-abc") }
            .Where(w => Label(w.Item1, "$v", -1.25f) != w.Item2 || Label(w.Item1, "<{$v}>", -1.25f) != "<" + w.Item2 + ">")
            .Select(w => $"{w.Item1} ({Label(w.Item1, "$v", -1.25f)}, {Label(w.Item1, "<{$v}>", -1.25f)})").ToArray();
        check(signedWidths.Length == 0,
              $"schema: a fmt with no digit and a width puts a negative number's minus sign inside the width {string.Join(" ", signedWidths)}".TrimEnd());
    }

    static IEnumerable<string> Ops(JsonElement row) => row.GetProperty("ops").EnumerateArray().Select(o => o.GetString()!);

    // What a requirement is written as, so the key that needs it is read: a gradient paint, because fat and sat sample one.
    static readonly Dictionary<string, string> Requirement = new()
    {
        ["f"] = "@g", ["s"] = "@g", ["s_"] = "@g", ["so"] = "1", ["sov"] = "1", ["tile"] = "[8,8]", ["slice"] = "[1,1,1,1]", ["ow"] = "1", ["id"] = "a",
    };

    // Values to try: the key works on the op when any of them changes the parse.
    static string[] Samples(string key, string type, JsonElement row) => key switch
    {
        "m" => ["[1,0,0,1,5,5]"],
        "uv" => ["[0,0,0.5,0.5]"],
        "weight" => ["bold"],
        _ => type switch
        {
            "num" => ["0.37", "1"],
            "int" => ["3"],
            "flag" => ["1", "0"],
            "enum" => row.GetProperty("enum").EnumerateArray().Select(w => w.GetString()!).ToArray(),
            "pair" => ["[0.37,0.37]"],
            "numlist" => ["[2,2,2,2]"],
            "paint" or "colour" => ["#ff0000"],
            "shadow" => ["[0,0,1,0,#000]"],
            "idref" => ["g", "@g"],
            "path" => ["\"M0 0 L1 1\""],
            _ => ["x"],
        },
    };

    // The scene a key is tried in: on SCENE in the header, on G with children to pass defaults to, else alone. An IMG
    // needs a src and a P a path for the rest to be read; written last, since the first of a key wins (PropValue).
    static string Text(string op, string attrs) => op switch
    {
        "SCENE" => $"SCENE {attrs}\n{Kids}",
        "G" => $"SCENE w=10 h=10\nG {attrs} {{\n{Kids}\n}}",
        "IMG" => $"SCENE w=10 h=10\nIMG {attrs} src=a.png",
        "P" => $"SCENE w=10 h=10\nP {attrs} d=\"M0 0 L4 0 L4 4 Z\"",
        _ => $"SCENE w=10 h=10\n{op} {attrs}",
    };

    static VecScene? Parse(string text)
    {
        var props = SceneText.ToProps(text, "s");
        return props == null ? null : SceneParser.Parse(props);
    }

    static void Repin(Action<bool, string> check)
    {
        foreach (var signs in new[] { 254, 255 })
        {
            var tail = new string('-', signs);
            foreach (var (expr, expected) in new[] {
                ($"=if(1,{tail}1,{tail}$gone)", signs % 2 == 0 ? 1f : -1f),
                ($"=and(0,{tail}$gone)", 0f), ($"=or(1,{tail}$gone)", 1f),
                ($"=mod({tail}$gone,0)", 0f), ($"=mix({tail}$gone,1,0.5)", 0f) })
            {
                var context = new EvalContext();
                check(Expression.Parse(expr, -999).Evaluate(context) == expected && context.Missing.Count == 0,
                      $"repin: lazy {expr.Split('(')[0]} at depth {signs + 2} leaves unresolved branches alone");
            }
        }
        var taken = new EvalContext();
        Expression.Parse("=and(1," + new string('-', 256) + "$gone)", -999).Evaluate(taken);
        check(taken.Missing.Contains("gone"), "repin: a taken deep branch still reports its unresolved data");

        foreach (var op in new[] { "RP", "LS", "YS" })
        {
            var large = Parse($"SCENE w=100 h=100\n{op} n=50000 v=0")!;
            var huge = Parse($"SCENE w=100 h=100\n{op} n=3000000000 v=0")!;
            check(large.Root[0].RepeatCount == 50000 && huge.Root[0].RepeatCount > 0,
                  $"repin: {op} keeps authored counts above 20000 and overflow does not become zero");
        }

        var inherited = Parse("SCENE w=100 h=100\nG fit=cover so=0.5 {\nT id=label w=50 h=20 text=hi\nSC id=list w=50 h=50 ch=200 sov=1\n}")!;
        SceneParser.PatchNodes(VectorHost.Props(new Dictionary<string, object> {
            ["nodes"] = new Dictionary<string, object> {
                ["label"] = new Dictionary<string, object> { ["w"] = 60 },
                ["list"] = new Dictionary<string, object> { ["ch"] = 300 } } }), inherited);
        check(inherited.Problems.Count == 0 && inherited.Root[0].Children[1].ScrollSet == null,
              "repin: patched children do not author inherited fit/so or invent a scroll offset");

        var booleanChip = FrameTests.Chip("ui:element{id='s',type='vector',rect={unit='px',w=100,h=100},props={w=100,h=100,root={{op='R',id=1,w=10,h=10,v=false},{op='T',id=2,w=20,h=20,text=42,wrap=true,press=true}}}}", 100, 100);
        var booleans = Compositor.Compose(booleanChip, "main", 1, true);
        check(booleans.Text is [{ Text: "42", Wrap: true }] && booleans.Spans.First(s => s.Node == 0).Count == 0 && booleans.Problems.Length == 0
              && booleanChip.Vectors.SceneOf("main", "s")!.Scene.Root[1].Pressable,
              "repin: numeric text and ids, boolean visibility/wrap/press pass through table props");
        check(Parse("SCENE w=100 h=100\nR w=10 h=10 v=false")!.Root[0].Visible!.Evaluate(new EvalContext()) == 0,
              "repin: lower-case false is zero in an expression");
        foreach (var text in new[] { "R w=10 h=10 x=\"=#fff\"", "T w=20 h=10 text=\"{=#fff}\"", "R w=10 h=10 x=\"=True\"" })
            check(Parse("SCENE w=100 h=100\n" + text)!.Problems.Count > 0, "repin: invalid numeric expression reports " + text);
        var patchError = Parse("SCENE w=100 h=100\nR id=box w=10 h=10")!;
        SceneParser.PatchNodes(VectorHost.Props(new Dictionary<string, object> {
            ["nodes"] = new Dictionary<string, object> { ["box"] = new Dictionary<string, object> { ["x"] = "=1+" } } }), patchError);
        check(patchError.Problems.Any(p => p.Contains("expression")), "repin: a patched expression reaches scene diagnostics");
        SceneParser.PatchNodes(VectorHost.Props(new Dictionary<string, object> { ["nodes"] = new object[] { new Dictionary<string, object> { ["w"] = 12 } } }), patchError);
        check(patchError.Problems.Any(p => p.Contains("1") && p.Contains("nodes")), "repin: a plain nodes list without matching numeric ids reports its mistake");

        foreach (var (spec, reported) in new[] { ("", false), ("%%", false), ("]", false), ("x{{y", true), ("%q", true), ("nonsense", true), ("{0:D3}", false) })
        {
            var scene = Parse($"SCENE w=100 h=100\nT w=50 h=20 text=\"<{{$v:{spec}}}>\"")!;
            check((scene.Problems.Count > 0) == reported, $"repin: placeholder format {spec} reported={reported}");
        }
        var formatted = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nT w=100 h=20 text=\"{=floor(t/60):%d:00} {$v:{0:D3}} {$v:}\""), 100, 100, t: 120, data: "{v=7}");
        check(formatted.Text.Single().Text == "2:00 007 7" && formatted.Problems.Length == 0,
              "repin: first-colon formats, composite braces and empty default draw together");
        check(Printf.ToNet("100%% of %.0f") == "100% of {0:F0}", "repin: printf collapses %% once before a conversion");
    }

    /// <summary>Whether key=value changes the parse of op (with its context); null when either text does not parse.</summary>
    static bool? Effect(string op, string key, string value, string context = "")
    {
        var without = Parse(Text(op, context));
        var with = Parse(Text(op, $"{context} {key}={value}".Trim()));
        return without == null || with == null ? null : Describe(without) != Describe(with);
    }

    // Everything a parse made, problems and source props aside: an expression by its value, a structure by its fields.
    static string Describe(object? v, int depth = 10)
    {
        switch (v)
        {
            case null: return "null";
            case Expression e:
                try { return "=" + e.Evaluate(new EvalContext()).ToString("R", CultureInfo.InvariantCulture); }
                catch (Exception x) { return "!" + x.GetType().Name; }
            case string s: return "\"" + s + "\"";
            case float f: return f.ToString("R", CultureInfo.InvariantCulture);
        }
        var t = v.GetType();
        if (t.IsPrimitive || t.IsEnum) return Convert.ToString(v, CultureInfo.InvariantCulture)!;
        if (depth == 0) return "...";
        if (v is IEnumerable list) return "[" + string.Join(",", list.Cast<object?>().Select(x => Describe(x, depth - 1))) + "]";
        if (!t.IsValueType && t.Assembly != typeof(VecNode).Assembly) return t.Name;
        return "{" + string.Join(",", t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
            .Where(f => f.Name is not ("Problems" or "SourceProps")).Select(f => f.Name + "=" + Describe(f.GetValue(v), depth - 1))) + "}";
    }
}
