import ExpoModulesCore

internal final class ICloudUnavailableException: Exception {
  override var reason: String {
    "iCloud Drive is unavailable — sign in to iCloud and turn on iCloud Drive"
  }
}

internal final class BadBase64Exception: Exception {
  override var reason: String { "Payload is not valid base64" }
}

internal final class FileMissingException: Exception {
  override var reason: String { "File does not exist in the iCloud container" }
}

internal final class DownloadTimeoutException: Exception {
  override var reason: String { "Timed out downloading the file from iCloud" }
}

public class ICloudDriveModule: Module {
  // url(forUbiquityContainerIdentifier:) provisions the container on first
  // call and can take seconds — cache the base URL so only one call pays
  private var containerBase: URL?

  // Documents/ inside the app's iCloud container — files here survive app
  // deletion and (with NSUbiquitousContainerIsDocumentScopePublic) appear
  // in the Files app under iCloud Drive
  private func containerDocuments() throws -> URL {
    let base: URL
    if let cached = containerBase {
      base = cached
    } else {
      guard let fresh = FileManager.default.url(forUbiquityContainerIdentifier: nil) else {
        throw ICloudUnavailableException()
      }
      containerBase = fresh
      base = fresh
    }
    let docs = base.appendingPathComponent("Documents", isDirectory: true)
    try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
    return docs
  }

  public func definition() -> ModuleDefinition {
    Name("ICloudDrive")

    // signed into iCloud with iCloud Drive on? cheap enough to call anywhere
    Function("isAvailable") { () -> Bool in
      FileManager.default.ubiquityIdentityToken != nil
    }

    // same check off the JS thread — ubiquityIdentityToken can stall on a
    // cold/odd iCloud state, and a synchronous call would freeze the app
    AsyncFunction("isAvailableAsync") { () -> Bool in
      FileManager.default.ubiquityIdentityToken != nil
    }

    AsyncFunction("writeFile") { (name: String, base64: String) in
      guard let data = Data(base64Encoded: base64) else { throw BadBase64Exception() }
      let url = try self.containerDocuments().appendingPathComponent(name)
      try data.write(to: url, options: .atomic)
    }

    // exists covers both a downloaded file and an undownloaded cloud
    // placeholder (.name.icloud) — right after a reinstall only the
    // placeholder is on disk
    AsyncFunction("fileInfo") { (name: String) -> [String: Any?] in
      let docs = try self.containerDocuments()
      let real = docs.appendingPathComponent(name)
      let placeholder = docs.appendingPathComponent(".\(name).icloud")
      let fm = FileManager.default
      let downloaded = fm.fileExists(atPath: real.path)
      let exists = downloaded || fm.fileExists(atPath: placeholder.path)
      guard exists else {
        return ["exists": false, "downloaded": false, "modifiedAt": nil, "size": nil]
      }
      let attrs = try? fm.attributesOfItem(atPath: downloaded ? real.path : placeholder.path)
      let date = attrs?[.modificationDate] as? Date
      let size = attrs?[.size] as? NSNumber
      return [
        "exists": true,
        "downloaded": downloaded,
        "modifiedAt": date.map { $0.timeIntervalSince1970 * 1000 },
        "size": size?.intValue,
      ]
    }

    // downloads from iCloud first if only the placeholder is local
    AsyncFunction("readFile") { (name: String, timeoutMs: Int) -> String in
      let docs = try self.containerDocuments()
      let url = docs.appendingPathComponent(name)
      let placeholder = docs.appendingPathComponent(".\(name).icloud")
      let fm = FileManager.default
      if !fm.fileExists(atPath: url.path) {
        guard fm.fileExists(atPath: placeholder.path) else { throw FileMissingException() }
        try fm.startDownloadingUbiquitousItem(at: url)
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
        while !fm.fileExists(atPath: url.path) {
          if Date() > deadline { throw DownloadTimeoutException() }
          Thread.sleep(forTimeInterval: 0.3)
        }
      }
      return try Data(contentsOf: url).base64EncodedString()
    }
  }
}
