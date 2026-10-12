using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace VectorBuilder.Core
{
    /// <summary>Unity's HTML colour grammar without the native call: #RGB #RGBA #RRGGBB #RRGGBBAA and Unity's named colours.</summary>
    /// <remarks>Names and values: the one name table in the game's UnityPlayer.dll (23 entries, in its order); case-insensitive, as measured on a console.</remarks>
    public static class ManagedColour
    {
        static readonly Dictionary<string, string> Named = new(StringComparer.OrdinalIgnoreCase)
        {
            ["red"] = "ff0000", ["cyan"] = "00ffff", ["blue"] = "0000ff", ["darkblue"] = "00008b", ["lightblue"] = "add8e6",
            ["purple"] = "800080", ["yellow"] = "ffff00", ["lime"] = "00ff00", ["fuchsia"] = "ff00ff", ["white"] = "ffffff",
            ["silver"] = "c0c0c0", ["grey"] = "808080", ["black"] = "000000", ["orange"] = "ffa500", ["brown"] = "a52a2a",
            ["maroon"] = "800000", ["green"] = "008000", ["olive"] = "808000", ["navy"] = "000080", ["teal"] = "008080",
            ["aqua"] = "00ffff", ["magenta"] = "ff00ff", ["transparent"] = "00000000",
        };

        public static bool TryParse(string s, out Color c)
        {
            c = default;
            if (string.IsNullOrEmpty(s)) return false;
            string? h;
            if (s[0] == '#') h = s.Substring(1);
            else if (!Named.TryGetValue(s, out h)) return false;
            if (h.Length == 3 || h.Length == 4) h = string.Concat(System.Linq.Enumerable.Select(h, ch => new string(ch, 2)));
            if (h.Length != 6 && h.Length != 8) return false;
            // AllowHexSpecifier only: HexNumber would also accept surrounding whitespace
            if (!uint.TryParse(h, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var v)) return false;
            if (h.Length == 6) v = (v << 8) | 0xFF;
            c = new Color32((byte)(v >> 24), (byte)(v >> 16), (byte)(v >> 8), (byte)v);
            return true;
        }
    }
}
