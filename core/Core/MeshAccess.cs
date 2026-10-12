using System.Collections.Generic;
using System.Runtime.CompilerServices;
using ScriptedScreensVector;
using UnityEngine;

namespace VectorBuilder.Core
{
    /// <summary>MeshBuilder keeps its lists private; these read them without reflection, and fail loudly if a name changes.</summary>
    internal static class MeshAccess
    {
        [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_positions")] internal static extern ref List<Vector3> PositionsOf(MeshBuilder b);
        [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_colours")] internal static extern ref List<Color> ColoursOf(MeshBuilder b);
        [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_uv1")] internal static extern ref List<Vector2> CoverageOf(MeshBuilder b);
        [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_uv2")] internal static extern ref List<Vector4> StoredColoursOf(MeshBuilder b);
        [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_uv0")] internal static extern ref List<Vector2> UvOf(MeshBuilder b);
        [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_indices")] internal static extern ref List<int> IndicesOf(MeshBuilder b);

        /// <summary>Tessellator's [ThreadStatic] concave-clip piece flag. Emit resets it at its start since 0.11.81; FrameTests uses this to prove it.</summary>
        [UnsafeAccessor(UnsafeAccessorKind.StaticField, Name = "_repeatPiece")]
        internal static extern ref bool RepeatPiece([UnsafeAccessorType("ScriptedScreensVector.Tessellator")] object? tessellator);
    }
}
