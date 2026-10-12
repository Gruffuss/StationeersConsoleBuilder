// Managed stand-ins for the UnityEngine types the vector sources use, so they compile without
// the engine (which cannot ship in a public web build, and whose ColorUtility is a native call).
// Written from Unity's public scripting docs; each member keeps Unity's documented managed
// behaviour (clamped Lerp, approximate ==, ternary Min/Max, banker's Round) so geometry matches
// the game. Only what the vector file set needs is here, except that Vector3 keeps all of Unity's
// operators: through the implicit Vector2/Vector3 conversions a missing one would still compile,
// via Vector2, and silently drop z.
using System;
using System.Collections.Generic;
using VectorBuilder.Core;

namespace UnityEngine
{
    public static class Mathf
    {
        public const float PI = (float)Math.PI;
        public const float Deg2Rad = PI * 2f / 360f;
        public const float Rad2Deg = 1f / Deg2Rad;
        public static readonly float Epsilon = float.Epsilon;

        public static float Sin(float f) => (float)Math.Sin(f);
        public static float Cos(float f) => (float)Math.Cos(f);
        public static float Tan(float f) => (float)Math.Tan(f);
        public static float Atan2(float y, float x) => (float)Math.Atan2(y, x);
        public static float Sqrt(float f) => (float)Math.Sqrt(f);
        public static float Abs(float f) => Math.Abs(f);
        public static int Abs(int value) => Math.Abs(value);
        public static float Min(float a, float b) => a < b ? a : b;
        public static int Min(int a, int b) => a < b ? a : b;
        public static float Max(float a, float b) => a > b ? a : b;
        public static int Max(int a, int b) => a > b ? a : b;
        public static float Pow(float f, float p) => (float)Math.Pow(f, p);
        public static float Exp(float power) => (float)Math.Exp(power);
        public static float Log(float f) => (float)Math.Log(f);
        public static float Ceil(float f) => (float)Math.Ceiling(f);
        public static float Floor(float f) => (float)Math.Floor(f);
        public static float Round(float f) => (float)Math.Round(f);
        public static int CeilToInt(float f) => (int)Math.Ceiling(f);
        public static int FloorToInt(float f) => (int)Math.Floor(f);
        public static int RoundToInt(float f) => (int)Math.Round(f);
        public static float Sign(float f) => f >= 0f ? 1f : -1f;
        public static float Clamp(float value, float min, float max) => value < min ? min : value > max ? max : value;
        public static int Clamp(int value, int min, int max) => value < min ? min : value > max ? max : value;
        public static float Clamp01(float value) => value < 0f ? 0f : value > 1f ? 1f : value;
        public static float Lerp(float a, float b, float t) => a + (b - a) * Clamp01(t);
        public static float LerpUnclamped(float a, float b, float t) => a + (b - a) * t;
        public static float Repeat(float t, float length) => Clamp(t - Floor(t / length) * length, 0f, length);

        public static float DeltaAngle(float current, float target)
        {
            var delta = Repeat(target - current, 360f);
            return delta > 180f ? delta - 360f : delta;
        }

        public static bool Approximately(float a, float b) =>
            Abs(b - a) < Max(0.000001f * Max(Abs(a), Abs(b)), Epsilon * 8);
    }

    public struct Vector2 : IEquatable<Vector2>
    {
        public const float kEpsilon = 0.00001f;
        public float x, y;

        public Vector2(float x, float y) { this.x = x; this.y = y; }

        public static Vector2 zero => new(0f, 0f);
        public static Vector2 one => new(1f, 1f);
        public static Vector2 up => new(0f, 1f);
        public static Vector2 down => new(0f, -1f);

        public float magnitude => (float)Math.Sqrt(x * x + y * y);
        public float sqrMagnitude => x * x + y * y;
        public Vector2 normalized { get { var mag = magnitude; return mag > kEpsilon ? this / mag : zero; } }

        public static float Dot(Vector2 a, Vector2 b) => a.x * b.x + a.y * b.y;
        public static float Distance(Vector2 a, Vector2 b) => (a - b).magnitude;
        public static Vector2 Lerp(Vector2 a, Vector2 b, float t) { t = Mathf.Clamp01(t); return new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
        public static Vector2 Min(Vector2 a, Vector2 b) => new(Mathf.Min(a.x, b.x), Mathf.Min(a.y, b.y));
        public static Vector2 Max(Vector2 a, Vector2 b) => new(Mathf.Max(a.x, b.x), Mathf.Max(a.y, b.y));
        public static Vector2 Scale(Vector2 a, Vector2 b) => new(a.x * b.x, a.y * b.y);

        public static Vector2 operator +(Vector2 a, Vector2 b) => new(a.x + b.x, a.y + b.y);
        public static Vector2 operator -(Vector2 a, Vector2 b) => new(a.x - b.x, a.y - b.y);
        public static Vector2 operator -(Vector2 a) => new(-a.x, -a.y);
        public static Vector2 operator *(Vector2 a, float d) => new(a.x * d, a.y * d);
        public static Vector2 operator *(float d, Vector2 a) => new(a.x * d, a.y * d);
        public static Vector2 operator /(Vector2 a, float d) => new(a.x / d, a.y / d);
        public static bool operator ==(Vector2 a, Vector2 b) => (a - b).sqrMagnitude < kEpsilon * kEpsilon;
        public static bool operator !=(Vector2 a, Vector2 b) => !(a == b);
        public static implicit operator Vector2(Vector3 v) => new(v.x, v.y);
        public static implicit operator Vector3(Vector2 v) => new(v.x, v.y, 0f);

        public bool Equals(Vector2 other) => x == other.x && y == other.y;
        public override bool Equals(object? other) => other is Vector2 v && Equals(v);
        public override int GetHashCode() => x.GetHashCode() ^ (y.GetHashCode() << 2);
    }

    public struct Vector3 : IEquatable<Vector3>
    {
        public const float kEpsilon = 0.00001f;
        public float x, y, z;

        public Vector3(float x, float y, float z) { this.x = x; this.y = y; this.z = z; }
        public Vector3(float x, float y) { this.x = x; this.y = y; z = 0f; }

        public static Vector3 zero => new(0f, 0f, 0f);
        public static Vector3 Min(Vector3 a, Vector3 b) => new(Mathf.Min(a.x, b.x), Mathf.Min(a.y, b.y), Mathf.Min(a.z, b.z));
        public static Vector3 Max(Vector3 a, Vector3 b) => new(Mathf.Max(a.x, b.x), Mathf.Max(a.y, b.y), Mathf.Max(a.z, b.z));

        public float magnitude => (float)Math.Sqrt(x * x + y * y + z * z);
        public float sqrMagnitude => x * x + y * y + z * z;
        public Vector3 normalized { get { var mag = magnitude; return mag > kEpsilon ? this / mag : zero; } }

        public static Vector3 Lerp(Vector3 a, Vector3 b, float t) { t = Mathf.Clamp01(t); return new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }

        public static Vector3 operator +(Vector3 a, Vector3 b) => new(a.x + b.x, a.y + b.y, a.z + b.z);
        public static Vector3 operator -(Vector3 a, Vector3 b) => new(a.x - b.x, a.y - b.y, a.z - b.z);
        public static Vector3 operator -(Vector3 a) => new(-a.x, -a.y, -a.z);
        public static Vector3 operator *(Vector3 a, float d) => new(a.x * d, a.y * d, a.z * d);
        public static Vector3 operator *(float d, Vector3 a) => new(a.x * d, a.y * d, a.z * d);
        public static Vector3 operator /(Vector3 a, float d) => new(a.x / d, a.y / d, a.z / d);
        public static bool operator ==(Vector3 a, Vector3 b) => (a - b).sqrMagnitude < kEpsilon * kEpsilon;
        public static bool operator !=(Vector3 a, Vector3 b) => !(a == b);

        public bool Equals(Vector3 other) => x == other.x && y == other.y && z == other.z;
        public override bool Equals(object? other) => other is Vector3 v && Equals(v);
        public override int GetHashCode() => x.GetHashCode() ^ (y.GetHashCode() << 2) ^ (z.GetHashCode() >> 2);
    }

    public struct Vector4 : IEquatable<Vector4>
    {
        public float x, y, z, w;
        public Vector4(float x, float y, float z, float w) { this.x = x; this.y = y; this.z = z; this.w = w; }

        public static Vector4 operator +(Vector4 a, Vector4 b) => new(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w);
        public static Vector4 operator *(Vector4 a, float t) => new(a.x * t, a.y * t, a.z * t, a.w * t);
        public static Vector4 Lerp(Vector4 a, Vector4 b, float t) { t = Mathf.Clamp01(t); return a * (1f - t) + b * t; }

        public static bool operator ==(Vector4 a, Vector4 b)
        {
            float dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, dw = a.w - b.w;
            return dx * dx + dy * dy + dz * dz + dw * dw < Vector3.kEpsilon * Vector3.kEpsilon;
        }
        public static bool operator !=(Vector4 a, Vector4 b) => !(a == b);
        public static implicit operator Vector4(Color c) => new(c.r, c.g, c.b, c.a);

        public bool Equals(Vector4 o) => x == o.x && y == o.y && z == o.z && w == o.w;
        public override bool Equals(object? other) => other is Vector4 v && Equals(v);
        public override int GetHashCode() => x.GetHashCode() ^ (y.GetHashCode() << 2) ^ (z.GetHashCode() >> 2) ^ (w.GetHashCode() >> 1);
    }

    public struct Color : IEquatable<Color>
    {
        public float r, g, b, a;

        public Color(float r, float g, float b, float a) { this.r = r; this.g = g; this.b = b; this.a = a; }

        public static Color white => new(1f, 1f, 1f, 1f);
        public static Color black => new(0f, 0f, 0f, 1f);

        public static Color Lerp(Color a, Color b, float t) { t = Mathf.Clamp01(t); return new(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t); }

        public static Color operator +(Color a, Color b) => new(a.r + b.r, a.g + b.g, a.b + b.b, a.a + b.a);
        public static Color operator *(Color a, float b) => new(a.r * b, a.g * b, a.b * b, a.a * b);
        public static Color operator *(float b, Color a) => new(a.r * b, a.g * b, a.b * b, a.a * b);
        // Unity compares colours as Vector4s: approximately
        public static bool operator ==(Color a, Color b) => (Vector4)a == b;
        public static bool operator !=(Color a, Color b) => !(a == b);

        public bool Equals(Color other) => r == other.r && g == other.g && b == other.b && a == other.a;
        public override bool Equals(object? other) => other is Color c && Equals(c);
        public override int GetHashCode() => ((Vector4)this).GetHashCode();
    }

    public struct Color32
    {
        public byte r, g, b, a;

        public Color32(byte r, byte g, byte b, byte a) { this.r = r; this.g = g; this.b = b; this.a = a; }

        public static implicit operator Color32(Color c) => new(
            (byte)Mathf.Round(Mathf.Clamp01(c.r) * 255f), (byte)Mathf.Round(Mathf.Clamp01(c.g) * 255f),
            (byte)Mathf.Round(Mathf.Clamp01(c.b) * 255f), (byte)Mathf.Round(Mathf.Clamp01(c.a) * 255f));
        public static implicit operator Color(Color32 c) => new(c.r / 255f, c.g / 255f, c.b / 255f, c.a / 255f);
    }

    public static class ColorUtility
    {
        public static bool TryParseHtmlString(string htmlString, out Color color) => ManagedColour.TryParse(htmlString, out color);

        public static string ToHtmlStringRGBA(Color color)
        {
            Color32 c = color;
            return $"{c.r:X2}{c.g:X2}{c.b:X2}{c.a:X2}";
        }
    }

    public struct Rect : IEquatable<Rect>
    {
        public float x, y, width, height;

        public Rect(Vector2 position, Vector2 size) : this(position.x, position.y, size.x, size.y) { }
        public Vector2 size => new(width, height);

        public Rect(float x, float y, float width, float height) { this.x = x; this.y = y; this.width = width; this.height = height; }

        public static Rect MinMaxRect(float xmin, float ymin, float xmax, float ymax) => new(xmin, ymin, xmax - xmin, ymax - ymin);

        public float xMin => x;
        public float yMin => y;
        public float xMax => x + width;
        public float yMax => y + height;
        public Vector2 min => new(xMin, yMin);
        public Vector2 max => new(xMax, yMax);
        public Vector2 center => new(x + width / 2f, y + height / 2f);

        public bool Contains(Vector2 point) => point.x >= xMin && point.x < xMax && point.y >= yMin && point.y < yMax;

        public static bool operator ==(Rect a, Rect b) => a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height;
        public static bool operator !=(Rect a, Rect b) => !(a == b);
        public bool Equals(Rect other) => this == other;
        public override bool Equals(object? other) => other is Rect r && this == r;
        public override int GetHashCode() => HashCode.Combine(x, y, width, height);
    }

    public struct Matrix4x4
    {
        // row-column names, as Unity's fields
        public float m00, m10, m20, m30, m01, m11, m21, m31, m02, m12, m22, m32, m03, m13, m23, m33;

        public float this[int i] => i switch
        {
            0 => m00, 1 => m10, 2 => m20, 3 => m30, 4 => m01, 5 => m11, 6 => m21, 7 => m31,
            8 => m02, 9 => m12, 10 => m22, 11 => m32, 12 => m03, 13 => m13, 14 => m23, 15 => m33,
            _ => throw new IndexOutOfRangeException(),
        };

        public static Matrix4x4 identity => new() { m00 = 1f, m11 = 1f, m22 = 1f, m33 = 1f };

        public static Matrix4x4 Translate(Vector3 v) { var m = identity; m.m03 = v.x; m.m13 = v.y; m.m23 = v.z; return m; }
        public static Matrix4x4 Scale(Vector3 v) => new() { m00 = v.x, m11 = v.y, m22 = v.z, m33 = 1f };

        public Vector3 MultiplyPoint3x4(Vector3 p) => new(
            m00 * p.x + m01 * p.y + m02 * p.z + m03,
            m10 * p.x + m11 * p.y + m12 * p.z + m13,
            m20 * p.x + m21 * p.y + m22 * p.z + m23);

        public Vector3 MultiplyVector(Vector3 v) => new(
            m00 * v.x + m01 * v.y + m02 * v.z,
            m10 * v.x + m11 * v.y + m12 * v.z,
            m20 * v.x + m21 * v.y + m22 * v.z);

        public static Matrix4x4 operator *(Matrix4x4 l, Matrix4x4 r) => new()
        {
            m00 = l.m00 * r.m00 + l.m01 * r.m10 + l.m02 * r.m20 + l.m03 * r.m30,
            m01 = l.m00 * r.m01 + l.m01 * r.m11 + l.m02 * r.m21 + l.m03 * r.m31,
            m02 = l.m00 * r.m02 + l.m01 * r.m12 + l.m02 * r.m22 + l.m03 * r.m32,
            m03 = l.m00 * r.m03 + l.m01 * r.m13 + l.m02 * r.m23 + l.m03 * r.m33,
            m10 = l.m10 * r.m00 + l.m11 * r.m10 + l.m12 * r.m20 + l.m13 * r.m30,
            m11 = l.m10 * r.m01 + l.m11 * r.m11 + l.m12 * r.m21 + l.m13 * r.m31,
            m12 = l.m10 * r.m02 + l.m11 * r.m12 + l.m12 * r.m22 + l.m13 * r.m32,
            m13 = l.m10 * r.m03 + l.m11 * r.m13 + l.m12 * r.m23 + l.m13 * r.m33,
            m20 = l.m20 * r.m00 + l.m21 * r.m10 + l.m22 * r.m20 + l.m23 * r.m30,
            m21 = l.m20 * r.m01 + l.m21 * r.m11 + l.m22 * r.m21 + l.m23 * r.m31,
            m22 = l.m20 * r.m02 + l.m21 * r.m12 + l.m22 * r.m22 + l.m23 * r.m32,
            m23 = l.m20 * r.m03 + l.m21 * r.m13 + l.m22 * r.m23 + l.m23 * r.m33,
            m30 = l.m30 * r.m00 + l.m31 * r.m10 + l.m32 * r.m20 + l.m33 * r.m30,
            m31 = l.m30 * r.m01 + l.m31 * r.m11 + l.m32 * r.m21 + l.m33 * r.m31,
            m32 = l.m30 * r.m02 + l.m31 * r.m12 + l.m32 * r.m22 + l.m33 * r.m32,
            m33 = l.m30 * r.m03 + l.m31 * r.m13 + l.m32 * r.m23 + l.m33 * r.m33,
        };
    }

    /// <summary>Signature-only: the browser reads MeshBuilder directly, nothing uploads a mesh headless.</summary>
    public sealed class Mesh
    {
        public void Clear(bool keepVertexLayout) => throw new NotSupportedException("no Unity mesh headless");
        public void SetVertices(List<Vector3> v, int start = 0, int length = -1) => throw new NotSupportedException("no Unity mesh headless");
        public void SetColors(List<Color> c, int start = 0, int length = -1) => throw new NotSupportedException("no Unity mesh headless");
        public void SetUVs(int channel, List<Vector2> uvs, int start = 0, int length = -1) => throw new NotSupportedException("no Unity mesh headless");
        public void SetUVs(int channel, List<Vector4> uvs, int start = 0, int length = -1) => throw new NotSupportedException("no Unity mesh headless");
        public void SetTriangles(List<int> triangles, int submesh, bool calculateBounds) => throw new NotSupportedException("no Unity mesh headless");
    }
}
