// Ported from scripted-screens-vector v0.11.118 VectorGraphic.cs (MIT) lines 524-541, 1745-1916, 1926-1957
// and 1370-1375, 2488-2509; keep in step with the pin.
using System;
using System.Collections.Generic;
using ScriptedScreensVector;
using UnityEngine;

namespace VectorBuilder.Core
{
    /// <summary>
    /// One structure element's live scene: VectorGraphic's data and clock state, Unity-free. Created on the element's
    /// first structure upsert and kept for its life, so data, `keep`, `ease` and `since` carry across payloads.
    /// Hover, down and scroll come from PointerInput (play mode). `Now()` is passed in, from the chip's clock.
    /// Not ported: the worker job and its parked payload (the preview emits synchronously), and the rebuild
    /// gating (`_needsRebuild`, `_dataDirty`, `_glidesUntil`), since the preview emits every frame.
    /// </summary>
    internal sealed class LiveScene
    {
        /// <summary>Shortest gap between payloads worth blending across.</summary>
        const float MinBlendSeconds = DataCadence.MinInterval;
        DataCadence _payloadCadence;

        readonly Dictionary<string, (float Start, float Seconds, Easing Curve, float Delay)> _glides = new(StringComparer.Ordinal);
        readonly List<string> _finishedGlides = new();
        float _startTime;
        float _dataArrived;
        float _dataInterval = MinBlendSeconds;

        internal LiveScene(string elementId) => ElementId = elementId;

        internal string ElementId { get; }
        internal VecScene Scene { get; private set; } = new();
        internal string? StructureText { get; set; }
        internal EvalContext Context { get; } = new();
        internal MeshBuilder Builder { get; } = new();
        internal TessellationStats Stats { get; } = new();

        // The pointer state VectorGraphic keeps (_hoverScope, _hoverIndex, _downScope, _downIndex, _offsets), set by
        // PointerInput and copied into the context at each dispatch (CopyPointer), so `hover`, `down` and an SC read it.
        internal string[]? HoverScope;
        internal int HoverIndex = -1;
        internal string[]? DownScope;
        internal int DownIndex = -1;
        internal readonly Dictionary<string, float> Offsets = new(StringComparer.Ordinal);

        /// <summary>The pairing key it was last registered under (VectorHost).</summary>
        internal string Key { get; set; } = "";

        /// <summary>Seconds of `t` at <paramref name="now"/>.</summary>
        internal float TimeAt(float now) => now - _startTime;

        /// <summary>
        /// Installs a parsed structure (ApplyScene). Resets the clock so animations start at t=0, unless
        /// <paramref name="keepClock"/>: the editor's hot-swap (M1 ruling 8), which no chip can send.
        /// </summary>
        internal void SetScene(VecScene scene, float now, bool keepClock = false)
        {
            Scene = scene;
            if (!keepClock)
                _startTime = now;
        }

        /// <summary>The dispatch preamble: what the clock decides before an Emit.</summary>
        internal void Prepare(float now)
        {
            Context.Time = now - _startTime;
            Context.Clock = now;

            // Blend across the gap the last two payloads were actually separated by, so this
            // self-tunes to whatever tick rate the script happens to use.
            Context.Blend = VectorConfig.SmoothData
                ? Mathf.Clamp01((now - _dataArrived) / _dataInterval)
                : 1f;

            SampleGlides(now);

            Context.HoverScope = HoverScope;
            Context.HoverIndex = HoverIndex;
            Context.DownScope = DownScope;
            Context.DownIndex = DownIndex;
            Context.ScrollOffsets.Clear();
            foreach (var (id, at) in Offsets)
                Context.ScrollOffsets[id] = at;
        }

        static bool EasesSomething(EvalContext source)
        {
            foreach (var name in source.Scalars.Keys)
            {
                if (!source.Snapped.Contains(name))
                    return true;
            }

            foreach (var name in source.Arrays.Keys)
            {
                if (!source.Snapped.Contains(name))
                    return true;
            }

            return false;
        }

        internal void ApplyData(EvalContext source, float now)
        {
            var interval = _payloadCadence.Arrive(now);
            var (changed, _) = Context.CompareData(source, Scene.UsesSince);
            // `since($name)` counts from here, whatever kind the value is.
            StampArrivals(source.Scalars.Keys, now);
            StampArrivals(source.Arrays.Keys, now);
            StampArrivals(source.Strings.Keys, now);
            StampArrivals(source.Colours.Keys, now);
            StampArrivals(source.StringArrays.Keys, now);
            StampArrivals(source.ColourArrays.Keys, now);
            if (!changed) return;

            // `keep = 1` means a payload is a PATCH: names it does not mention hold their last
            // value. Without it a payload is the whole truth and anything absent is gone.
            var keep = source.KeepUnmentioned;

            // Only a payload carrying EASED numbers restarts the blend clock. Patches arriving within
            // the minimum of each other are one batch. A changed full payload always starts a batch.
            var batch = !keep || (EasesSomething(source) && now - _dataArrived >= MinBlendSeconds);

            if (batch)
            {
                // Keep what is on screen: the next frames ease from it to the new payload rather than snapping.
                Context.Rebase(VectorConfig.SmoothData
                    ? Mathf.Clamp01((now - _dataArrived) / _dataInterval)
                    : 1f);

                _dataInterval = interval;
                _dataArrived = now;

                // Hand the old arrays over rather than copying them: ReadData allocates fresh ones.
                Context.PreviousArrays.Clear();
                foreach (var pair in Context.Arrays)
                    Context.PreviousArrays[pair.Key] = pair.Value;
            }

            // An eased colour glides from what it shows right now, so that is read before anything
            // below replaces or evicts it. Without an `ease` entry a colour changes at once.
            foreach (var pair in source.Colours)
            {
                if (source.Eased.ContainsKey(pair.Key) && Context.Colour(pair.Key, out var showing))
                    Context.PreviousColours[pair.Key] = showing;
                else
                    Context.PreviousColours.Remove(pair.Key);
            }


            if (!keep)
                Context.Scalars.Clear();
            else
                Context.Evict(source);

            foreach (var pair in source.Scalars)
                Context.Scalars[pair.Key] = pair.Value;

            if (!keep)
                Context.Arrays.Clear();

            foreach (var pair in source.Arrays)
                Context.Arrays[pair.Key] = pair.Value;

            // `snap = 1`: no previous value, so these names read their new value at once.
            foreach (var name in source.Snapped)
            {
                Context.Previous.Remove(name);
                Context.PreviousArrays.Remove(name);
                _glides.Remove(name);
                Context.NameBlend.Remove(name);
            }

            // A stated glide starts now and runs for as long as the payload asked, regardless of
            // when the next payload arrives. Restating a name restarts its glide from whatever it
            // is showing, which `Rebase` above has already written into `Previous`.
            foreach (var pair in source.Eased)
            {
                _glides[pair.Key] = (now, pair.Value.Seconds, pair.Value.Curve, pair.Value.Delay);
            }

            // A name this payload carries without timing goes back to the scene-wide blend.
            foreach (var name in source.Scalars.Keys)
            {
                if (!source.Eased.ContainsKey(name))
                    Forget(name);
            }

            foreach (var name in source.Arrays.Keys)
            {
                if (!source.Eased.ContainsKey(name))
                    Forget(name);
            }

            if (!keep)
                Context.Colours.Clear();

            foreach (var pair in source.Colours)
                Context.Colours[pair.Key] = pair.Value;

            if (!keep)
                Context.Strings.Clear();

            foreach (var pair in source.Strings)
                Context.Strings[pair.Key] = pair.Value;

            if (!keep)
                Context.StringArrays.Clear();

            foreach (var pair in source.StringArrays)
                Context.StringArrays[pair.Key] = pair.Value;

            if (!keep)
                Context.ColourArrays.Clear();

            foreach (var pair in source.ColourArrays)
                Context.ColourArrays[pair.Key] = pair.Value;

            void StampArrivals<T>(Dictionary<string, T>.KeyCollection names, float at)
            {
                foreach (var name in names)
                    Context.ArrivedAt[name] = at;
            }

            void Forget(string name)
            {
                if (_glides.Count == 0)
                    return;

                _glides.Remove(name);
                Context.NameBlend.Remove(name);
            }
        }

        /// <summary>How far along each stated glide is. A finished glide is dropped rather than left at 1.</summary>
        void SampleGlides(float now)
        {
            if (_glides.Count == 0)
            {
                if (Context.NameBlend.Count > 0)
                    Context.NameBlend.Clear();

                return;
            }

            _finishedGlides.Clear();

            foreach (var pair in _glides)
            {
                // Clamped at the bottom as well as the top, so during a delay the fraction is 0.
                var progress = Mathf.Clamp01(
                    (now - pair.Value.Start - pair.Value.Delay) / Mathf.Max(0.0001f, pair.Value.Seconds));
                Context.NameBlend[pair.Key] = VectorConfig.SmoothData ? pair.Value.Curve.Evaluate(progress) : 1f;

                if (progress >= 1f)
                    _finishedGlides.Add(pair.Key);
            }

            foreach (var name in _finishedGlides)
            {
                _glides.Remove(name);
                Context.NameBlend.Remove(name);
                Context.Previous.Remove(name);
                Context.PreviousArrays.Remove(name);
            }
        }
    }
}
