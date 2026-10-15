// swift-tools-version: 6.2
import PackageDescription
let package = Package(
    name: "ForgePadSpeech",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "forgepad-speech", targets: ["ForgePadSpeech"])],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", revision: "82eb4c1e0ab67e1c7d8de5092aa42a8f74cbd7b8", traits: [])
    ],
    targets: [.executableTarget(name: "ForgePadSpeech", dependencies: [.product(name: "FluidAudio", package: "FluidAudio")])]
)
