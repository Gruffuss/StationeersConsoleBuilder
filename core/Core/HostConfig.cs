using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace VectorBuilder.Core
{
    // What the page hands the chip besides its Lua (web/src/codegen/hostOf.ts writes it): the enum numbers, the simulated
    // devices and the housing, the chip's persist and memory, the day clock, the beta toggle and the budgets. The core holds
    // no catalogue: access lists, enum numbers and identities all come from here. Source-generated (the app is trimmed).
    public sealed record HostJson(Dictionary<string, Dictionary<string, int>>? enums, DeviceJson[]? devices, DeviceJson? housing,
        Dictionary<string, string>? persist, double[]? memory, ClockJson? clock, bool beta = false, BudgetsJson? budgets = null,
        Dictionary<string, Dictionary<string, string>>? icons = null)
    {
        public static readonly HostJson Empty = new(null, null, null, null, null, null);

        /// <summary>The host the page sent; blank text is the empty host. Never throws: invalid JSON gives the empty host and why; a housing-ref collision skips that device and reports a warning.</summary>
        public static HostJson Parse(string? json, out string? error)
        {
            error = null;
            if (string.IsNullOrWhiteSpace(json))
                return Empty;
            try
            {
                var host = JsonSerializer.Deserialize(json, HostContext.Default.HostJson) ?? Empty;
                if (host.clock is { } clock && (!double.IsFinite(clock.length) || clock.length <= 0 || !double.IsFinite(clock.start)))
                    host = host with { clock = null };
                if (host.housing is { } housing && Array.Exists(host.devices ?? [], d => d != null && d.@ref == housing.@ref))
                {
                    error = $"a device sharing the housing ref {housing.@ref} was skipped";
                    host = host with { devices = Array.FindAll(host.devices!, d => d == null || d.@ref != housing.@ref) };
                }
                var refs = new HashSet<long>();
                foreach (var device in host.devices ?? [])
                    if (device != null && !refs.Add(device.@ref))
                    {
                        error = "duplicate device ref";
                        return Empty;
                    }
                return host;
            }
            catch (Exception e) when (e is JsonException or NotSupportedException or ArgumentException or InvalidOperationException or FormatException)
            {
                error = "the host could not be read: " + e.Message;
                return Empty;
            }
        }
    }

    public sealed record DeviceJson(long @ref, int prefab, string? prefabName, string? name, int? pin, Dictionary<string, string>? logic,
        int slots = 0, Dictionary<string, int[]>? slotLogic = null, Dictionary<string, SourceJson>? values = null, Dictionary<string, SourceJson>? slotValues = null,
        string? prefabDisplayName = null);

    public sealed record SourceJson(string? kind, double v = 0, double min = 0, double max = 0, double mid = 0, double amp = 0, double period = 0,
        double from = 0, double to = 0, bool loop = false, double step = 0, int seed = 0, double[][]? keys = null);

    public sealed record ClockJson(double length, double start);
    public sealed record BudgetsJson(int load = 500_000, int tick = 50_000);
    public sealed record DeviceWrite(long @ref, int lt, int slot, double value, bool stored);

    /// <summary>Live changes from the Sim panel (values: ref → LogicType number or "slot:lst" → source), with no reload.</summary>
    public sealed record SimJson(Dictionary<string, Dictionary<string, SourceJson>>? values, bool wipePersist = false, bool clearWrites = false)
    {
        public static SimJson? Parse(string? json, out string? error)
        {
            error = null;
            try { return JsonSerializer.Deserialize(json ?? "", HostContext.Default.SimJson); }
            catch (Exception e) when (e is JsonException or NotSupportedException or ArgumentException or InvalidOperationException or FormatException)
            {
                error = "the change could not be read: " + e.Message;
                return null;
            }
        }
    }

    // Named literals: chip memory and a written value may be NaN or infinite (ruling P20; without this, System.Text.Json throws).
    [JsonSourceGenerationOptions(NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals)]
    [JsonSerializable(typeof(HostJson))]
    [JsonSerializable(typeof(SimJson))]
    internal sealed partial class HostContext : JsonSerializerContext { }
}
