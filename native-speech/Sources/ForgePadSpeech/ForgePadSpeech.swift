import Foundation
import FluidAudio

// A narrow subprocess boundary: no microphone access, only explicit model preparation
// or transcription of a temporary file supplied by the Rust service.
@main
struct ForgePadSpeech {
    static func main() async {
        do {
            let args = CommandLine.arguments
            if args.count == 2 && args[1] == "status" {
                let versions: [(String, AsrModelVersion)] = [("ultra", .ultra), ("v3", .v3), ("v2", .v2)]
                emit(Dictionary(uniqueKeysWithValues: versions.map { id, version in
                    (id, AsrModels.modelsExist(at: AsrModels.defaultCacheDirectory(for: version), version: version))
                }))
                return
            }
            guard args.count >= 3, ["prepare", "transcribe"].contains(args[1]) else {
                throw SpeechError.message("Expected prepare|transcribe ultra|v3|v2 [audio-path]")
            }
            let version: AsrModelVersion
            switch args[2] {
            case "ultra": version = .ultra
            case "v3": version = .v3
            case "v2": version = .v2
            default: throw SpeechError.message("Unsupported Parakeet model")
            }
            if args[1] == "prepare" {
                _ = try await AsrModels.downloadAndLoad(version: version)
                emit(["ready": true, "model": args[2]])
                return
            }
            guard AsrModels.modelsExist(at: AsrModels.defaultCacheDirectory(for: version), version: version) else {
                throw SpeechError.message("Speech model is not downloaded. Download it in Settings first.")
            }
            let models = try await AsrModels.loadFromCache(version: version)
            guard args.count == 4 else { throw SpeechError.message("An audio file is required") }
            let manager = AsrManager(config: .default)
            try await manager.loadModels(models)
            var state = try TdtDecoderState(decoderLayers: await manager.decoderLayerCount)
            let result = try await manager.transcribe(URL(fileURLWithPath: args[3]), decoderState: &state)
            emit(["text": result.text])
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }
    static func emit(_ object: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
           let line = String(data: data, encoding: .utf8) { print(line) }
    }
}
enum SpeechError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case let .message(text) = self { return text } }
}
