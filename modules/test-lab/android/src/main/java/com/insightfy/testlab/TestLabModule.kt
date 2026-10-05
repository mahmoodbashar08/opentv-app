package com.insightfy.testlab

import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Firebase Test Lab — which runs Play's pre-launch report — sets this on every
// device it drives. Google's documented way to tell a robot from a person.
class TestLabModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TestLab")
    Function("isTestLab") {
      val resolver = appContext.reactContext?.contentResolver ?: return@Function false
      Settings.System.getString(resolver, "firebase.test.lab") == "true"
    }
  }
}
