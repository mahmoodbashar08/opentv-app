Pod::Spec.new do |s|
  s.name           = 'WidgetRefresh'
  s.version        = '1.0.0'
  s.summary        = 'WidgetKit reload trigger for OpenTV'
  s.description    = 'Lets the app ask WidgetKit to re-render the home-screen widgets.'
  s.author         = 'Insightfy LLC'
  s.homepage       = 'https://github.com/insightfy/opentv'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end
