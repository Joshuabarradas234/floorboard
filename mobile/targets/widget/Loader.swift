// Gets the widget's snapshot by itself, so it stays current without the app being opened: refreshes the login if
// it has run out, reads the store's records, and works out what to show by running src/snapshot.js (the same code
// the app and the Android widget use) in JavaScriptCore.
import Foundation
import JavaScriptCore

// keep in step with app.json (appGroup) and src/store.js (the keys)
let appGroup = "group.io.github.joshuabarradas234.floorboard"
let authKey = "floorboard.auth"
let snapshotKey = "floorboard.snapshot"
let snapshotColls = ["meta", "users", "depts", "posts", "rcp", "plans", "ptasks", "pdone", "deadlines", "dltick"]

// What the app saved at log in (src/store.js setAuth). The names match the JSON.
struct Auth: Codable {
  var url: String
  var key: String
  var staff: String
  var name: String?
  var access_token: String
  var refresh_token: String
  var expires_at: Double
}

enum LoadError: Error { case signedOut, http(Int), bad }

enum Loader {
  static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

  static func decode<T: Decodable>(_ type: T.Type, _ json: String?) -> T? {
    guard let json = json, let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }
  static func readAuth() -> Auth? { decode(Auth.self, defaults?.string(forKey: authKey)) }
  static func saveAuth(_ a: Auth) {
    if let data = try? JSONEncoder().encode(a), let json = String(data: data, encoding: .utf8) { defaults?.set(json, forKey: authKey) }
  }
  static func cached() -> Snap? { decode(Snap.self, defaults?.string(forKey: snapshotKey)) }

  static func load() async -> Snap {
    guard let first = readAuth() else { return Snap.message("signedout") }
    // the app has just refreshed and asked the widget to redraw: no need to fetch again
    if let c = cached(), c.state == "ok", c.stale != true, let at = c.at, Date().timeIntervalSince1970 * 1000 - at < 60_000 { return c }
    do {
      let auth = try await validAuth(first)
      let records = try await fetchRecords(auth)
      guard let json = build(records: records, staff: auth.staff), let snap = decode(Snap.self, json) else { throw LoadError.bad }
      if snap.state == "ok" || snap.state == "gone" { defaults?.set(json, forKey: snapshotKey) }
      return snap
    } catch LoadError.signedOut {
      defaults?.removeObject(forKey: authKey)
      defaults?.removeObject(forKey: snapshotKey)
      return Snap.message("signedout")
    } catch {
      if var c = cached() { c.stale = true; return c }
      return Snap.message("offline")
    }
  }

  static func request(_ auth: Auth, _ path: String, token: String? = nil) -> URLRequest? {
    guard let url = URL(string: auth.url + path) else { return nil }
    var req = URLRequest(url: url, timeoutInterval: 20)
    req.setValue(auth.key, forHTTPHeaderField: "apikey")
    req.setValue("Bearer " + (token ?? auth.key), forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    return req
  }

  // The access token lasts an hour. A refresh retires the old refresh token, so the new pair goes straight back into
  // the App Group for the app to use too.
  static func validAuth(_ a: Auth) async throws -> Auth {
    if a.expires_at - 60 > Date().timeIntervalSince1970 { return a }
    guard var req = request(a, "/auth/v1/token?grant_type=refresh_token") else { throw LoadError.bad }
    req.httpMethod = "POST"
    req.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": a.refresh_token])
    let (data, resp) = try await URLSession.shared.data(for: req)
    let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
    if code == 400 || code == 401 {
      // the app may have refreshed a moment ago with the same token: use what it saved
      if let now = readAuth(), now.refresh_token != a.refresh_token { return now }
      throw LoadError.signedOut
    }
    guard code == 200, let t = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let access = t["access_token"] as? String, let refresh = t["refresh_token"] as? String else { throw LoadError.http(code) }
    var next = a
    next.access_token = access
    next.refresh_token = refresh
    next.expires_at = (t["expires_at"] as? Double) ?? Date().timeIntervalSince1970 + ((t["expires_in"] as? Double) ?? 3600)
    saveAuth(next)
    return next
  }

  // only the parts of the store the widget needs, 1000 at a time; returned as one JSON array
  static func fetchRecords(_ auth: Auth) async throws -> String {
    var all: [Any] = []
    var from = 0
    while true {
      let path = "/rest/v1/records?select=coll,id,data&coll=in.(" + snapshotColls.joined(separator: ",") + ")&order=coll.asc,id.asc&limit=1000&offset=\(from)"
      guard let req = request(auth, path, token: auth.access_token) else { throw LoadError.bad }
      let (data, resp) = try await URLSession.shared.data(for: req)
      let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
      if code == 401 { throw LoadError.http(code) }
      guard code == 200, let rows = try JSONSerialization.jsonObject(with: data) as? [Any] else { throw LoadError.http(code) }
      all.append(contentsOf: rows)
      if rows.count < 1000 { break }
      from += 1000
    }
    let data = try JSONSerialization.data(withJSONObject: all)
    guard let json = String(data: data, encoding: .utf8) else { throw LoadError.bad }
    return json
  }

  // snapshotSource is src/snapshot.js, copied into SnapshotSource.swift by scripts/embed-snapshot.js
  static func build(records: String, staff: String) -> String? {
    guard let ctx = JSContext() else { return nil }
    ctx.evaluateScript(snapshotSource)
    guard let fn = ctx.objectForKeyedSubscript("floorboardSnapshot"), !fn.isUndefined,
          let out = fn.call(withArguments: [records, staff, Date().timeIntervalSince1970 * 1000]), out.isString else { return nil }
    return out.toString()
  }
}
