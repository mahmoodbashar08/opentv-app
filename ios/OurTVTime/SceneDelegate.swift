//
//  THE APP WOULD NOT LAUNCH ON iOS 27 WITHOUT THIS FILE.
//
//  1.6.3 build 45 was rejected under guideline 2.1(a) — "crashed on launch",
//  reviewed on an iPad Air on iPadOS 27.0. It was not the iPad and not a
//  feature of 1.6.3. UIKit terminates the process before a single line of our
//  own code runs, and says so:
//
//      _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption
//      Application failed to launch: UIScene life cycle is required for apps
//      built with this SDK.
//
//  "Built with this SDK" is the whole of it. Apple warned about the scene
//  lifecycle for years, made it a runtime issue in iOS 26, and made it fatal
//  in 27 for anything compiled against the new SDK. So this is not a bug that
//  was introduced — it is a deadline that passed, and every build we ship from
//  now on meets it or does not start. The reviewer's iPad was simply the first
//  iOS 27 device the binary ever met; every phone in this house is on 26.
//
//  EXPO HAS NOT DONE THIS FOR US. `ExpoAppDelegate.swift` still carries
//  `// TODO: - Configuring and Discarding Scenes`, so SDK 57 hands us the old
//  lifecycle and nothing else. This file is therefore hand-written, like the
//  widget target and `FirebaseApp.configure()` — and like them it is destroyed
//  by `npx expo prebuild`, which must never be run here. The matching
//  `UIApplicationSceneManifest` lives in BOTH `Info.plist` (what the local
//  build reads) and `app.json` (so a regenerated project still has it).
//
//  WHAT MOVED, AND WHAT DID NOT. Adopting scenes does not just relocate the
//  window: UIKit stops calling a long list of UIApplicationDelegate methods
//  and sends the scene equivalents instead. `ExpoAppDelegateSubscriberManager`
//  fans those app-delegate methods out to every Expo module that asked for
//  them — notifications, linking, updates — so silently losing them would have
//  broken deep links and background handling in a way no crash would announce.
//  Every handler below therefore forwards to the AppDelegate rather than
//  reimplementing anything. The app delegate stays the one place that decides
//  what a URL means; this file only carries the message now that UIKit has
//  changed who it tells.
//

import React
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }

    // `UIWindow(windowScene:)` and NOT `UIWindow(frame: UIScreen.main.bounds)`,
    // which is what the app delegate used to do. On an iPad the two are not the
    // same rectangle: the app is resizable (`UIRequiresFullScreen` is false),
    // so the screen's bounds are the whole display while the window is whatever
    // the user has dragged it to. Binding the window to its scene is what makes
    // a resized or split-view window lay out against its own size.
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    // A COLD LAUNCH ARRIVES HERE, not at `scene(_:openURLContexts:)`, and it
    // has to be put back where React Native looks for it.
    //
    // THIS IS THE TRAP THE WHOLE MIGRATION TURNS ON. `Linking.getInitialURL()`
    // is not an event — it is a question asked once, after JS boots, and
    // `RCTLinkingManager` answers it from exactly one place:
    //
    //     launchOptions[UIApplicationLaunchOptionsURLKey]
    //
    // Under the scene lifecycle UIKit stops putting the URL there and hands it
    // to us in `connectionOptions` instead, so that dictionary is empty and the
    // question is answered "nothing". Forwarding to `application(_:open:)`
    // instead does NOT rescue it: that posts an event, and at this instant
    // React Native has not booted, so nobody is listening. The URL is simply
    // gone.
    //
    // What that costs is the feature this release is built on: every widget in
    // `OpenTVWidgets.swift` is a `Link`/`widgetURL` into `opentv://`, and a
    // widget is tapped precisely when the app is NOT already running. Tap
    // tonight's episode, land on the home screen. No crash, no log, nothing to
    // notice until somebody complains.
    //
    // So the URL goes back into `launchOptions` before React Native starts,
    // shaped the way `RCTLinkingManager` reads it — including the universal
    // link form, which it takes from the user-activity dictionary rather than
    // the URL key.
    var options = appDelegate.launchOptions ?? [:]
    if let url = connectionOptions.urlContexts.first?.url {
      options[.url] = url
    } else if let web = connectionOptions.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }) {
      options[.userActivityDictionary] = [
        UIApplication.LaunchOptionsKey.userActivityType: web.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": web,
      ] as [AnyHashable: Any]
    }

    appDelegate.reactNativeFactory?.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: options
    )

    // Anything that is NOT a link still goes down the old road: a Siri intent
    // or a Spotlight result arrives as a user activity that the app delegate
    // and its Expo subscribers already know how to read. Browsing-web is
    // excluded because it was just handed to React Native above, and handling
    // it twice would navigate twice.
    for activity in connectionOptions.userActivities
    where activity.activityType != NSUserActivityTypeBrowsingWeb {
      _ = appDelegate.application(UIApplication.shared, continue: activity) { _ in }
    }
  }

  // MARK: - Links, while the app is already running

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(UIApplication.shared, continue: userActivity) { _ in }
  }

  // MARK: - Lifecycle
  //
  // These five are the ones UIKit stops sending to the app delegate once a
  // scene manifest exists. React Native itself is fine either way — `AppState`
  // listens for the UIApplication *notifications*, which are still posted —
  // but Expo's subscribers are wired to the delegate *methods*, and those
  // would simply never fire again. Forwarding keeps the app's observable
  // behaviour identical to build 45's on iOS 26.

  func sceneDidBecomeActive(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationDidEnterBackground(UIApplication.shared)
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationWillTerminate(UIApplication.shared)
  }
}
