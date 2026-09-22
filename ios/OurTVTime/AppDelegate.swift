internal import Expo
import FirebaseCore
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  /// Held for `SceneDelegate`, which is where React Native is started now.
  ///
  /// Under the scene lifecycle the window does not exist yet at
  /// `didFinishLaunchingWithOptions` -- UIKit creates the scene afterwards --
  /// but `launchOptions` is only ever handed to THIS method. React Native
  /// needs it (a push notification that launched the app arrives in it), so
  /// it is kept here until the scene connects and can use it.
  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // WHAT THE @react-native-firebase/app CONFIG PLUGIN WOULD HAVE WRITTEN.
    //
    // It never ran: `ios/` was generated before the plugin was added to
    // app.json, and a plugin only applies during prebuild. Without this call
    // FirebaseCore logs "No app has been configured yet" and every analytics
    // event is silently dropped — the SDK has nowhere to send them.
    //
    // Done by hand rather than by prebuild because `npx expo prebuild -p ios`
    // regenerates the project from app.json's name and DELETES the
    // OpenTVWidgets target along with this file's edits. If you ever do run a
    // prebuild, expect to restore the widget extension, the Podfile's
    // filter_map polyfill and $RNFirebaseDisableSPM, and this call.
    //
    // Must come before React Native starts, so the JS `logEvent` calls in
    // analytics.ts have a configured app by the time they run.
    FirebaseApp.configure()

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // THE WINDOW IS NOT MADE HERE ANY MORE. It is made by `SceneDelegate`,
    // because iOS 27 refuses to launch an app built against this SDK that has
    // not adopted the scene lifecycle -- see the note at the top of
    // SceneDelegate.swift for the whole story. Creating a window here as well
    // would give the app two, and the one UIKit shows would be the empty one.
    self.launchOptions = launchOptions

    // SIRI NEEDS THE LIBRARY INDEXED to bind a spoken title to a film rather
    // than answering with a picker. Detached and best-effort — see
    // OpenTVIntents.swift. Runs on every launch because the shared index the
    // entities are built from is rewritten whenever the library changes.
    OpenTVIndexing.reindex()

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
