using System;
using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Text.Json.Serialization;
using VectorBuilder.Core;

namespace VectorBuilder.Wasm;

[JsonSerializable(typeof(MetadataResult))]
internal sealed partial class FontMetadataJson : JsonSerializerContext { }

public static partial class Exports
{
    // Called only by the independent metadata runtime. It never reads or writes chip state.
    [JSExport]
    public static string ReadFontMetadata(byte[] data)
    {
        try { return JsonSerializer.Serialize(FontMetadata.Read(data), FontMetadataJson.Default.MetadataResult); }
        catch (OutOfMemoryException) { return """{"status":"read-budget","cause":"too large to read names from here: runtime allocation failed"}"""; }
        catch (Exception e)
        {
            try { return JsonSerializer.Serialize(new MetadataResult("failed", "the metadata runtime could not read font names: " + e.Message), FontMetadataJson.Default.MetadataResult); }
            catch { return """{"status":"failed","cause":"the metadata runtime could not report its failure"}"""; }
        }
    }
}
