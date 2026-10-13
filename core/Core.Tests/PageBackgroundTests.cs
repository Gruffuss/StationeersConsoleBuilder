using System;
using System.IO;
using System.Linq;
using VectorBuilder.Core;

static class PageBackgroundTests
{
    public static void Run(Action<bool, string> check)
    {
        var quad = new SurfaceFrame([0, 0, 10, 0, 10, 10, 0, 10], [0, 0, 0, 128, 0, 0, 0, 128, 0, 0, 0, 128, 0, 0, 0, 128],
            [1, 1, 1, 1], [0, 1, 2, 0, 2, 3], [], [], [], []);
        check(Math.Abs(FrameTests.Sample(quad, 5, 5).A - 128 / 255.0) < 1e-6,
            "frame sampler: a quad's shared diagonal blends once, following the rasterizer fill rule");
        foreach (var name in new[] { "none", "translucent" })
        {
            var chip = new ChipRunner();
            chip.Screens.Size = (64, 64);
            chip.LoadAsync(File.ReadAllText(Path.Combine(Fixtures.Root, "fixtures", "background", name + ".lua"))).Wait();
            check(chip.State == ChipState.Running, "page background " + name + ": exported Lua loads: " + chip.Error);
            chip.Screens.QueueVisit("p1"); chip.TickAsync().Wait();
            check(chip.Screens.ActiveSurface == "main", "page background " + name + ": explicitly visits the edited page");
            check(!chip.Screens.ElementsOf("main").Any(e => e.Id == "bg"), "page background " + name + ": no native bg panel");
            var frame = Compositor.Compose(chip, "main", 1, false);
            check(frame.Problems.Length == 0 && FrameTests.Sample(frame, 8.5f, 8.5f).A == 0,
                "page background " + name + ": empty area has no target coverage");
            if (name == "none") check(frame.Positions.Length == 0 && frame.Indices.Length == 0 && frame.Elements.Length == 0,
                "page background none: blank page has no marker geometry or target coverage");
            if (name == "translucent") check(Math.Abs(FrameTests.Sample(frame, 32.5f, 32.5f).A - .5) < .01,
                "page background translucent: scene opacity is not flattened over a native panel");
            if (Environment.GetEnvironmentVariable("VB_BACKGROUND_FRAMES") is { } dir)
                File.WriteAllBytes(Path.Combine(dir, name + ".vbf"), FrameWriter.Write(frame));
            chip.Screens.QueueVisit("vb_devices"); chip.TickAsync().Wait();
            check(chip.State == ChipState.Running && chip.Screens.ActiveSurface == "vb_devices"
                && !chip.Screens.ElementsOf("vb_devices").Any(e => e.Id == "bg"),
                "page background " + name + ": Devices page inherits none");
        }
    }
}
