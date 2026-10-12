// Ported from scripted-screens-vector v0.11.118 (MIT) VectorGraphic.cs lines 598-1100: OnPointerClick, PollPointer/SetHover, OnPointerDown,
// PollDrag, FinishDrag, OnPointerUp, OnPointerExit, CheckLeave, HitAt, Tagged, TrackHoverEvents, OnScroll, Locate and Move;
// keep in step with the pin, as LiveScene.cs is. Unity's event system is replaced by the canvas's pointer (surface px), and
// each value goes through the fake ScriptedScreens' event queue as the element's click (the next tick dispatches it).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using ScriptedScreensVector;
using UnityEngine;

namespace VectorBuilder.Core
{
    public sealed class PointerInput
    {
        const double Debounce = 0.25;   // ScriptedScreens' forwarder: a second plain click from one pointer within 0.25 s is dropped (ruling P11; provisional, P10)
        const double DragSlop = 10;     // past this many px a press gives no plain click, as Unity's drag threshold (provisional, P10)

        sealed class Press
        {
            public string Surface = "", Element = "";
            public double X, Y;
            public bool Moved, Pressed, Inside;
            public HitRegion Region;
            public string? Candidate, Dragged;
        }

        readonly ChipRunner chip;
        readonly Dictionary<int, Press> presses = new();
        readonly Dictionary<int, double> lastClick = new();
        string? hoverEvent;
        (string Surface, string Element) hoverAt;

        public PointerInput(ChipRunner chip) => this.chip = chip;

        record struct Under(ElementRecord? E, LiveScene? Live, Vector2 Local);

        // The topmost vector element under the point (z_index, then creation order, as the compositor draws them), and the point in
        // its builder space: x from the rect's left, y up from its bottom (ruling P17).
        Under At(string surface, double x, double y)
        {
            var (w, h) = chip.Screens.SizeOf(surface);
            foreach (var e in chip.Screens.ElementsOf(surface).Where(e => e.Flushed && Compositor.Visible(e.Props) && chip.Vectors.IsActive(surface, e.Id))
                         .OrderByDescending(e => Compositor.ZIndex(e.Props)).ThenByDescending(e => e.Order))
            {
                var live = chip.Vectors.SceneOf(surface, e.Id);
                var (ex, ey, ew, eh) = Compositor.RectOf(e.Rect, w, h);
                if (live != null && ew > 0 && eh > 0 && x >= ex && y >= ey && x <= ex + ew && y <= ey + eh)
                {
                    var local = new Vector2((float)(x - ex), (float)(eh - (y - ey)));
                    // IsRaycastLocationValid: empty space in an element lets a lower element take the pointer.
                    if (HitAt(live, local, out _) || Locate(live, local, out _))
                        return new(e, live, local);
                }
            }
            return default;
        }

        Vector2 LocalIn(string surface, string element, double x, double y)
        {
            var (w, h) = chip.Screens.SizeOf(surface);
            var e = chip.Screens.ElementsOf(surface).FirstOrDefault(r => r.Id == element);
            var (ex, ey, _, eh) = Compositor.RectOf(e?.Rect, w, h);
            return new Vector2((float)(x - ex), (float)(eh - (y - ey)));
        }

        static bool HitAt(LiveScene live, Vector2 local, out HitRegion region)
        {
            region = default;
            var found = false;
            foreach (var r in live.Stats.Hits)
                if (r.Contains(local)) { region = r; found = true; }   // last match wins: drawn last is on top
            return found;
        }

        static bool Locate(LiveScene live, Vector2 local, out ScrollRegion region)
        {
            region = default;
            var found = false;
            foreach (var s in live.Stats.Scrolls)
                if (s.Rect.Contains(local)) { region = s; found = true; }
            return found && region.Max > 0f;
        }

        static string Tagged(HitRegion region, Vector2 local)
        {
            var at = region.Fraction(local);
            return at is { } f
                ? region.Id + "@" + f.x.ToString("0.000", CultureInfo.InvariantCulture) + "," + f.y.ToString("0.000", CultureInfo.InvariantCulture)
                : region.Id;
        }

        void Send(string surface, string element, string value) => chip.Screens.Enqueue(surface, element, "click", value);

        public void Apply(string surface, double x, double y, string type, double dy = 0, int pointer = 0)
        {
            if (!double.IsFinite(x) || !double.IsFinite(y) || !double.IsFinite(dy))
                return;
            var u = At(surface, x, y);
            HitRegion? hit = u.Live != null && HitAt(u.Live, u.Local, out var r) ? r : null;
            switch (type)
            {
                case "move": Move(surface, x, y, u, hit, pointer); break;
                case "down": Down(surface, x, y, u, hit, pointer); break;
                case "up": Up(surface, x, y, u, hit, pointer); break;
                case "leave": Leave(surface, pointer); break;
                case "wheel": Wheel(u, dy); break;
            }
        }

        void Hover(string surface, Under u, HitRegion? hit)
        {
            foreach (var page in chip.Screens.SurfaceNames)
                foreach (var e in chip.Screens.ElementsOf(page))
                    if (chip.Vectors.SceneOf(page, e.Id) is { } live && live != u.Live)
                        (live.HoverScope, live.HoverIndex) = (null, -1);
            if (u.Live != null)
                (u.Live.HoverScope, u.Live.HoverIndex) = (hit?.Scope, hit?.Index ?? -1);
            var id = hit is { HoverEvents: true } h ? h.Id : null;
            if (id == hoverEvent && (id == null || hoverAt == (surface, u.E!.Id)))
                return;
            if (hoverEvent != null)
                Send(hoverAt.Surface, hoverAt.Element, "exit:" + hoverEvent);
            hoverEvent = id;
            if (id != null)
            {
                hoverAt = (surface, u.E!.Id);
                Send(surface, u.E.Id, "enter:" + id);
            }
        }

        void Move(string surface, double x, double y, Under u, HitRegion? hit, int pointer)
        {
            Hover(surface, u, hit);
            if (!presses.TryGetValue(pointer, out var p))
                return;
            if (Math.Abs(x - p.X) > DragSlop || Math.Abs(y - p.Y) > DragSlop)
                p.Moved = true;
            // CheckLeave: a held press plate the pointer has moved off sends leave: once
            if (p.Pressed && p.Inside && !(surface == p.Surface && u.E?.Id == p.Element && p.Region.Contains(u.Local)))
            {
                p.Inside = false;
                Send(p.Surface, p.Element, "leave:" + p.Region.Id);
            }
            // PollDrag: holding a drag = 1 region and moving off it starts the drag
            if (p.Candidate != null && p.Dragged == null && !(surface == p.Surface && u.E?.Id == p.Element && hit is { } d && d.Id == p.Candidate))
            {
                p.Dragged = p.Candidate;
                Send(p.Surface, p.Element, "dragstart:" + p.Dragged);
            }
        }

        void Down(string surface, double x, double y, Under u, HitRegion? hit, int pointer)
        {
            var p = new Press { Surface = surface, X = x, Y = y };
            presses[pointer] = p;
            if (u.Live == null)
                return;
            // IsRaycastLocationValid: only a hit region or a scroll container takes the press
            if (hit is not { } h)
            {
                if (Locate(u.Live, u.Local, out _))
                    p.Element = u.E!.Id;
                return;
            }
            p.Element = u.E!.Id;
            (u.Live.DownScope, u.Live.DownIndex) = (h.Scope, h.Index);
            if (h.Drag)
                p.Candidate = h.Id;
            if (h.Press)
            {
                (p.Pressed, p.Inside, p.Region) = (true, true, h);
                Send(surface, p.Element, "down:" + Tagged(h, u.Local));
            }
        }

        void Up(string surface, double x, double y, Under u, HitRegion? hit, int pointer)
        {
            if (!presses.Remove(pointer, out var p))
                return;
            if (p.Element != "" && chip.Vectors.SceneOf(p.Surface, p.Element) is { } held)
                (held.DownScope, held.DownIndex) = (null, -1);
            // FinishDrag: drop:src>dst over a drop = 1 region of the same element, then dragend:src
            if (p.Dragged != null)
            {
                if (hit is { Drop: true } target && surface == p.Surface && u.E?.Id == p.Element)
                    Send(p.Surface, p.Element, "drop:" + p.Dragged + ">" + target.Id);
                Send(p.Surface, p.Element, "dragend:" + p.Dragged);
            }
            // up: wherever the pointer is, for a press plate
            if (p.Pressed)
                Send(p.Surface, p.Element, "up:" + Tagged(p.Region, LocalIn(p.Surface, p.Element, x, y)));
            // OnPointerClick: a release over the element the press landed on, on the region under it
            if (p.Element == "" || p.Moved || surface != p.Surface || u.E?.Id != p.Element || hit is not { } c)
                return;
            var now = chip.Now;
            if (lastClick.TryGetValue(pointer, out var last) && now - last < Debounce)
                return;
            lastClick[pointer] = now;
            Send(surface, p.Element, Tagged(c, u.Local));
        }

        void Leave(string surface, int pointer)
        {
            foreach (var e in chip.Screens.ElementsOf(surface))
                if (chip.Vectors.SceneOf(surface, e.Id) is { } live)
                    (live.HoverScope, live.HoverIndex) = (null, -1);
            if (hoverEvent != null)
                Send(hoverAt.Surface, hoverAt.Element, "exit:" + hoverEvent);
            hoverEvent = null;
            if (presses.TryGetValue(pointer, out var p) && p.Pressed && p.Inside)
            {
                p.Inside = false;
                Send(p.Surface, p.Element, "leave:" + p.Region.Id);
            }
        }

        // OnScroll: wheel up shows earlier content, a smaller offset; nothing is sent to the chip.
        static void Wheel(Under u, double dy)
        {
            if (u.Live == null || !Locate(u.Live, u.Local, out var region))
                return;
            u.Live.Offsets.TryGetValue(region.Id, out var at);
            u.Live.Offsets[region.Id] = region.Clamp(at - (float)dy * region.WheelStep);
        }
    }
}
