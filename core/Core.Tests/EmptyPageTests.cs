using System;
using System.IO;
using System.Linq;
using VectorBuilder.Core;

static class EmptyPageTests
{
    public static void Run(Action<bool, string> check)
    {
        string Lua(string name) => File.ReadAllText(Path.Combine(Fixtures.Root, "fixtures", name == "natives" ? "codegen" : "empty-pages", name + ".lua"));
        var chip = new ChipRunner();
        void Push(string name)
        {
            chip.LoadAsync(Lua(name)).Wait();
            check(chip.State == ChipState.Running, "empty page: " + name + " exported Lua loads: " + chip.Error);
            chip.TickAsync().Wait();
        }
        bool HasVector() => chip.Screens.ElementsOf("main").Any(e => e.Type.Equals("vector", StringComparison.OrdinalIgnoreCase));
        Push("blank");
        check(!HasVector() && chip.Vectors.SceneOf("main", "scene") == null,
            "empty page: runtime declares no vector element for a blank page");
        var frame = Compositor.Compose(chip, "main", 1, true);
        check(frame.Positions.Length == 0 && frame.Indices.Length == 0 && frame.Text.Length == 0
            && frame.Elements.Length == 0 && frame.Problems.Length == 0,
            "empty page: preview frame has no marker geometry or magenta pixels");
        chip.LoadAsync("function U.before_render(P, S, data) data.sample = VB.n end").Wait();
        chip.TickAsync().Wait();
        check(chip.State == ChipState.Running && !HasVector(),
            "empty page: hook data changes do not patch absent data carriers");
        Push("first-node");
        check(HasVector() && chip.Vectors.SceneOf("main", "scene") != null
            && Compositor.Compose(chip, "main", 1, true).Indices.Length > 0,
            "empty page: re-push with the first node creates the vector scene");
        Push("blank");
        check(!HasVector() && Compositor.Compose(chip, "main", 1, true).Indices.Length == 0,
            "empty page: re-push clearing the last node removes the vector scene");
        Push("natives");
        check(!HasVector() && chip.Screens.ElementsOf("main").Any(e => e.Id == "ico1"),
            "empty page: natives alone declare no vector element and retain native elements");
        foreach (var name in new[] { "problem-node", "hidden-node" })
        {
            Push(name);
            frame = Compositor.Compose(chip, "main", 1, true);
            var edge = FrameTests.Sample(frame, 1.5f, 1.5f);
            check(frame.Indices.Length > 0 && edge.A > 0
                && Enumerable.Range(0, frame.Colours.Length / 4).Any(i => frame.Colours[i * 4] > frame.Colours[i * 4 + 1]
                    && frame.Colours[i * 4 + 2] > frame.Colours[i * 4 + 1] && frame.Colours[i * 4 + 3] > 0)
                && (name == "hidden-node" ? frame.Problems.Length == 0 : frame.Problems.Length > 0),
                "empty page: " + name + " keeps the mod's magenta marker");
        }
    }
}
