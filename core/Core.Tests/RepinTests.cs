using System;
using System.Linq;
using VectorBuilder.Core;
using ScriptedScreensVector;

static class RepinTests
{
    public static void Run(Action<bool, string> check)
    {
        check(SceneParser.Parse(SceneText.ToProps("SCENE w=100 h=100 nofill=true\nR w=100 h=100 f=#fff", "s")!)!.DebugNoFill, "repin 116: lowercase scene true enables nofill");
        var lists = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nL p=[0,false,100,true] s=#fff sw=2"), 100, 100);
        check(lists.Problems.Length == 0 && lists.Indices.Length > 0, "repin 116: lowercase booleans in numeric lists");
        var data = new EvalContext();
        SceneParser.ReadData(VectorHost.Props(new System.Collections.Generic.Dictionary<string, object> { ["data"] = new System.Collections.Generic.Dictionary<string, object> { ["a"] = new object[] { 0, "true", "false" } } }), data);
        check(data.Arrays["a"].SequenceEqual(new float[] { 0, 1, 0 }), "repin 116: numeric DATA arrays read string true/false as one/zero");
        foreach (var src in new[] { "R w=10 h=10 x1=3", "R w=10 h=10 bw=word", "R w=10 h=10 x==mix($v,$w,0.5)" })
            check(FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\n" + src), 100, 100).Problems.Length > 0, "repin 116: reports " + src);
        foreach (var control in new[] { "keep='=1'", "snap='=1'", "ease={a='=1',b='=1'}", "nodes={box=3}" })
        {
            var chip = FrameTests.Chip("ui:element{ id='s', type='vector', rect={unit='px',w=100,h=100}, props={ src='SCENE w=100 h=100\\nR id=box w=10 h=10' } }\nui:element{ id='d', type='vector', props={ scene='s',data={a=1}," + control + "} }", 100, 100);
            var problems = Compositor.Compose(chip, "main", 1, false).Problems;
            check(problems.Length >= (control.StartsWith("ease") ? 2 : 1), "repin 116/117: DATA reports " + control);
            if (control.StartsWith("ease")) check(problems.Any(p => p.Message.Contains("\"a\"")) && problems.Any(p => p.Message.Contains("\"b\"")), "repin 117: ease reports every named bad entry");
        }
        var missing = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nT text=$a[4] w=100 h=50"), 100, 100, data: "{a={'one'}}");
        check(missing.Problems.Any(p => p.Message == "unresolved data name $a"), "repin 117: out-of-range text array is unresolved DATA");
        var declared = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nT text=$a[4] missing=empty w=100 h=50"), 100, 100, data: "{a={'one'}}");
        check(declared.Problems.Length == 0, "repin 117: missing suppresses unresolved text array");
        foreach (var text in new[] { "$a[4]", "value {$a[4]}" })
        {
            var numeric = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nT text=\"" + text + "\" w=100 h=50"), 100, 100, data: "{a={1}}");
            var numericMissing = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nT text=\"" + text + "\" missing=empty w=100 h=50"), 100, 100, data: "{a={1}}");
            check(numeric.Problems.Any(p => p.Message == "unresolved data name $a") && numericMissing.Problems.Length == 0,
                "repin 117: out-of-range numeric array text reports unresolved DATA unless missing is declared: " + text);
        }
        var pixels = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nR x=10 y=10 w=50 h=50 f=#fff"), 100, 100);
        var edges = pixels.Edges;
        check(edges.Length == pixels.Positions.Length / 2 && edges.Any(e => e != 0), "repin 117: frame carries automatic edge distances");
        var fallback = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100 nopixeledges=true\nR x=10 y=10 w=50 h=50 f=#fff"), 100, 100);
        check(fallback.Edges.All(e => e == 0) && fallback.Problems.Length == 0, "repin 117: nopixeledges selects geometric fallback");
        var duct = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nL p=[0,50,1e9,50] dash=[6,4] dofs==t*20 s=#fff sw=2"), 100, 100, t: .25);
        check(duct.Problems.Length == 0 && duct.Indices.Length > 0 && duct.Positions.All(float.IsFinite), "repin 114/115: billion-unit moving 6/4 duct draws without a freeze");
        const string ramp = "SCENE w=100 h=100\nDEFS { GL id=g units=bbox x1=0 y1=0 x2=1 y2=0 stops=[[0,#5FD9A8],[1,#2E8B6E]] }\n";
        var solid = FrameTests.Draw(FrameTests.Src(ramp + "L p=[0,50,100,50] sw=10 s=@g fea=0"), 100, 100);
        var dashed = FrameTests.Draw(FrameTests.Src(ramp + "L p=[0,50,100,50] sw=10 s=@g dash=[60,40] fea=0"), 100, 100);
        var sr = FrameTests.Sample(solid, 50, 50); var dr = FrameTests.Sample(dashed, 50, 50);
        check(solid.Problems.Length == 0 && dashed.Problems.Length == 0 && Math.Abs(sr.R - 70.6) < .2 && Math.Abs(dr.R - sr.R) < .01,
            "repin 118: solid and dashed whole-path sRGB gradient midpoint matches the reported 70.6 red");
        foreach (var level in new[] { 5, 10, 20 })
        {
            var dark = FrameTests.Draw(FrameTests.Src($"SCENE w=100 h=100\nR w=100 h=100 f=#{level:X2}{level:X2}{level:X2} fea=0"), 100, 100);
            check(dark.StoredColours.Where((_, i) => i % 4 == 0).All(c => Math.Abs(c * 255 - level) < .0001)
                && dark.StoredColours.Where((_, i) => i % 4 == 3).All(c => c == 1), $"repin 118: dark flat {level} travels as float sRGB");
        }
        foreach (var fixture in new[] { "repin-colours.src", "repin-edges.src" })
        {
            var source = System.IO.File.ReadAllText(System.IO.Path.Combine(Fixtures.Root, "fixtures", "frames", fixture));
            var frame = FrameTests.Draw(FrameTests.Src(source), 480, 480);
            check(frame.Problems.Length == 0 && frame.Indices.Length > 0, "repin: owner comparison page parses and draws " + fixture);
        }
        var live = new LiveScene("s");
        EvalContext Payload(float n) { var d = new EvalContext(); d.Scalars["a"] = n; return d; }
        live.ApplyData(Payload(0), 0);
        live.ApplyData(Payload(10), 1);
        live.ApplyData(Payload(10), 1.25f);
        live.Prepare(1.5f);
        check(Math.Abs(Expression.Parse("$a", 0).Evaluate(live.Context) - 5) < 1e-5, "repin 116: identical DATA does not restart the blend");
        check(Math.Abs(live.Context.Since("a") - .25f) < 1e-5, "repin 116: identical DATA still stamps since");
        live.ApplyData(Payload(20), 1.5f);
        live.Prepare(1.625f);
        check(Math.Abs(Expression.Parse("$a", 0).Evaluate(live.Context) - 12.5f) < 1e-5, "repin 116: changed DATA uses cadence including equal payloads");
        var queued = FrameTests.Chip("ui:element{ id='d',type='vector',props={scene='s',data={},ease={a='=1',b='=1'}} }\nui:element{ id='s',type='vector',rect={unit='px',w=100,h=100},props={src='SCENE w=100 h=100\\nR w=10 h=10'} }", 100, 100);
        check(Compositor.Compose(queued, "main", 1, false).Problems.Count(p => p.Message.Contains("ease")) == 2, "repin 116/117: queued ease diagnoses both entries");
        var longPath = FrameTests.Chip("ui:element{ id='s',type='vector',rect={unit='px',w=100,h=100},props={src='SCENE w=100 h=100\\nL p=[0,50,1e9,50] dash=[1e7,1e7] s=#fff sw=2'} }", 100, 100);
        var longFrame = Compositor.Compose(longPath, "main", 1, false);
        check(longPath.Vectors.SceneOf("main", "s")!.Stats.CulledDashes && longFrame.Problems.Length == 0, "repin 114: billion-unit dashed path gets the visible window");
        var zero = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nG s=[0,0] { L p=[0,50,1e9,50] dash=[6,4] dofs=NaN s=#fff sw=2 }"), 100, 100);
        check(zero.Positions.All(float.IsFinite) && !zero.Problems.Any(p => p.Message.Contains("could not be drawn")), "repin 115: zero-scale dashed path and non-finite dofs stay finite");

    }
}
