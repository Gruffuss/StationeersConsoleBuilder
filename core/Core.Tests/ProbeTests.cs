using System;
using System.IO;
using System.Linq;
using VectorBuilder.Core;

static class ProbeTests
{
    public static void Run(Action<bool, string> check)
    {
        var root = Path.Combine(Fixtures.Root, "..", "..", "tools");
        var probe = File.ReadAllText(Path.Combine(root, "catalog", "enums-probe.lua"));
        var host = HostJson.Parse("""{"enums":{"LogicType":{"Pressure":1},"Extra":{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8,"i":9,"j":10}}}""", out _);
        var chip = new ChipRunner(host: host);
        chip.LoadAsync(probe).Wait();
        var first = Array.Empty<string>();
        for (var k = 0; k < 4; k++)
        {
            var before = chip.Output.Count;
            chip.TickAsync().Wait();
            var lines = chip.Output.Skip(before).ToArray();
            if (k == 0) first = lines;
            check(chip.State == ChipState.Running && (k == 2 ? lines.Length == 2 && lines[1] == "ENUM DONE 11"
                      : lines.Length == 5 && lines.All(l => l.StartsWith("ENUM ") && !l.StartsWith("ENUM DONE")))
                  && (k != 3 || lines.SequenceEqual(first)),
                  $"enums-probe: tick {k + 1} emits five rows at most, DONE then restarts ({string.Join(" | ", lines)})");
        }
        probe = File.ReadAllText(Path.Combine(root, "ingame", "probes.lua"));
        host = HostJson.Parse("""{"enums":{"LogicType":{"Pressure":1},"LogicBatchMethod":{"Average":0,"Sum":1,"Minimum":2}}}""", out _);
        chip = new ChipRunner(host: host);
        chip.LoadAsync("""
            ic.batch_read = function(hash, lt, method) if method == 0 then error('bad method') end return method end
            """ + probe).Wait();
        check(chip.State == ChipState.Running && chip.Output.Any(l => l.StartsWith("PROBE 3 Average 0 false/") && l.Contains("bad method"))
              && chip.Output.Any(l => l.StartsWith("PROBE 3 Sum 1 true/1")) && chip.Output.Any(l => l.StartsWith("PROBE 3 Minimum 2 true/2")),
              "probes P3: each batch method is tried separately so one raise cannot hide another answer");
    }
}
