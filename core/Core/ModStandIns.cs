// The two pieces of the vector mod's plugin shell its headless sources call: the config and the log.
// The mod's own Tests/ConfigStub.cs and Tests/Stubs.cs serve its tests (LOD on, a log that keeps
// everything); a preview needs what the game does.
using System.Collections.Generic;

namespace ScriptedScreensVector
{
    // The game's defaults, from vector VectorConfig.cs: each property's `?? default`, which is also its Bind
    // default. Curve and count LOD are off there (and forced off by the settings-v3 migration), so the
    // preview draws every curve sample and every `lod=1` instance, as an unedited game does.
    internal static class VectorConfig
    {
        internal static bool Diagnostics => false;
        internal static float Dither => 4f;
        internal static bool PixelEdges => true;
        internal static float BlurDensity => 1f;
        internal static bool BlurLod => true;
        internal static bool SmoothData => true;
        internal static bool PauseWithGame => true;
        internal static bool CurveLodEnabled => false;
        internal static float PixelsPerSegment => 3f;
        internal static int MinimumSegments => 8;
        internal static bool CountLodEnabled => false;
        internal static float CountFloor => 0.45f;
        internal static float CountFullDetailPixels => 320f;
    }

    /// <summary>The mod's log: warnings and errors, the last 64 lines. Some sites log per emit, so it must not grow.</summary>
    internal sealed class ModLog
    {
        const int MaxLines = 64;
        internal Queue<string> Warnings { get; } = new();

        internal void LogWarning(string message) => Add(message);
        internal void LogInfo(string message) { }
        internal void LogError(string message) => Add("ERROR: " + message);

        void Add(string line)
        {
            Warnings.Enqueue(line);
            if (Warnings.Count > MaxLines)
                Warnings.Dequeue();
        }
    }

    internal static class ScriptedScreensVectorPlugin
    {
        internal static ModLog? Log { get; } = new();
    }
}
