using System;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace VectorBuilder.Core
{
    /// <summary>A frame's JSON section.</summary>
    internal sealed record FrameBody(FrameElement[] Elements, FrameText[] Text, FrameProblem[] Problems, FrameImage[] Images, string[] Pending);

    // Source-generated: the published app is trimmed, which turns reflection-based serialisation off in the browser only.
    // Named float literals: one script's NaN in a rect or a label must not fail the whole frame.
    [JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
                                 NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals)]
    [JsonSerializable(typeof(FrameBody))]
    internal sealed partial class FrameJson : JsonSerializerContext { }

    /// <summary>
    /// A frame as VBF3, little-endian, every section 4-byte aligned:
    /// "VBF3", int32 V (vertices), I (indices), S (spans), J (JSON bytes), then float32[2V] positions, float32[V] coverage, float32[V] edge distance, float32[2V] UVs,
    /// uint8[4V] colours, float32[4V] stored sRGB (UV2), uint32[I] indices, int32[4S] spans (element, node, first, count), and uint8[J] UTF-8 JSON
    /// {"elements":[…],"text":[…],"problems":[…],"images":[{"element","src","first","count"}],"pending":[src…]}.
    /// </summary>
    public static class FrameWriter
    {
        // ponytail: host byte order, which is little-endian on wasm, x64 and arm64.
        public static byte[] Write(SurfaceFrame f)
        {
            var json = JsonSerializer.SerializeToUtf8Bytes(new FrameBody(f.Elements, f.Text, f.Problems, f.Images, f.Pending), FrameJson.Default.FrameBody);
            int v = f.Positions.Length / 2, i = f.Indices.Length, s = f.Spans.Length;
            var bytes = new byte[20 + 44 * v + 4 * i + 16 * s + json.Length];
            var at = 0;
            void Put(ReadOnlySpan<byte> part)
            {
                part.CopyTo(bytes.AsSpan(at));
                at += part.Length;
            }

            ReadOnlySpan<int> head = [v, i, s, json.Length];
            Put("VBF3"u8);
            Put(MemoryMarshal.AsBytes(head));
            Put(MemoryMarshal.AsBytes(f.Positions.AsSpan()));
            Put(MemoryMarshal.AsBytes(f.Coverage.AsSpan()));
            Put(MemoryMarshal.AsBytes(f.Edges.AsSpan()));
            Put(MemoryMarshal.AsBytes(f.Uv.AsSpan()));
            Put(f.Colours);
            Put(MemoryMarshal.AsBytes(f.StoredColours.AsSpan()));
            Put(MemoryMarshal.AsBytes(f.Indices.AsSpan()));
            Put(MemoryMarshal.AsBytes(f.Spans.AsSpan()));  // FrameSpan is four int32s, in declaration order
            Put(json);
            return bytes;
        }
    }
}
