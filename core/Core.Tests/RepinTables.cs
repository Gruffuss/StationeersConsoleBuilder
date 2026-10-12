using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using ScriptedScreensVector;
using UnityEngine;

static class RepinTables
{
    public static void Run(Action<bool, string> check)
    {
        var outline = new List<object>();
        foreach (var (font, point, gs) in new (string?, float, float)[] { (null, 86, 10), ("Barlow", 48, 6) })
        foreach (var size in new[] { 1f, 48f, 86f, 96f })
        foreach (var stroke in new[] { 0f, 1f, 8f, 14.625f, 16f, 100f })
        {
            var width = TextOutline.Width(stroke, size, point, gs, .1875f, out var drawn);
            outline.Add(new { font, size, stroke, width = stroke * drawn, boldRatio = 1f / Math.Max(1f, .1875f + width) });
        }
        var edge = new List<object>();
        foreach (var g in new[] { 0f, .1f, 1f, 2f })
        foreach (var y in new[] { -.065f, 0f, .065f, .5f })
        foreach (var band in new[] { .3f, 1f })
            edge.Add(new { y, g, x = .75f, band, coverage = EdgeRamp.Coverage(y, g, .75f, 1.3f, band) });
        var path = Path.Combine(Fixtures.Root, "fixtures", "frames", "shader-tables.json");
        var json = JsonSerializer.Serialize(new { outline, edge }) + "\n";
        if (Fixtures.Write) File.WriteAllText(path, json);
        check(File.Exists(path) && File.ReadAllText(path) == json, "repin: outline and edge tables come from the tag's C# arithmetic");
        var m = Matrix4x4.identity; m.m01 = 2; m.m10 = 3; m.m03 = 4;
        check(Enumerable.Range(0, 16).Select(i => m[i]).SequenceEqual(new float[] { 1,3,0,0,2,1,0,0,0,0,1,0,4,0,0,1 }), "repin: Unity matrix indexing is column-major");
        var a = new Vector4(1,2,3,4); var b = new Vector4(5,6,7,8);
        check(Vector4.Lerp(a,b,-1) == a && Vector4.Lerp(a,b,2) == b && Vector4.Lerp(a,b,.5f) == (a+b)*.5f, "repin: Vector4 interpolation clamps and keeps all four channels");
        check(new Rect(new Vector2(2,3),new Vector2(4,5)).size == new Vector2(4,5)
            && Vector3.Min(new Vector3(1,4,6),new Vector3(2,3,5)) == new Vector3(1,3,5)
            && Vector3.Max(new Vector3(1,4,6),new Vector3(2,3,5)) == new Vector3(2,4,6), "repin: Rect size and Vector3 extrema preserve every component");
    }
}
