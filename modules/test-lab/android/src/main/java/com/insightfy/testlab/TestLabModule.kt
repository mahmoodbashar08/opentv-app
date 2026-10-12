package com.insightfy.testlab

import android.app.ActivityManager
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Is this one of Google's robots? Three signals, any one is enough:
//  - `firebase.test.lab`, the setting Firebase Test Lab documents. Not enough
//    on its own: robots kept signing in from 1.6.6–1.7.0 builds that checked it.
//  - the user test harness (API 29+), which automated test devices switch on.
//  - "monkey", Android's own random-tap tester.
class TestLabModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TestLab")
    Function("isTestLab") {
      val context = appContext.reactContext ?: return@Function false
      val setting = Settings.System.getString(context.contentResolver, "firebase.test.lab") == "true"
      val harness = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && ActivityManager.isRunningInUserTestHarness()
      setting || harness || ActivityManager.isUserAMonkey()
    }
  }
}
