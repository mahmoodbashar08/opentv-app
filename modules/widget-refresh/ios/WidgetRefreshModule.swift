import ExpoModulesCore
import WidgetKit

public class WidgetRefreshModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WidgetRefresh")

    Function("reloadAll") {
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }
  }
}
