Pod::Spec.new do |s|
  s.name           = 'ICloudDrive'
  s.version        = '1.0.0'
  s.summary        = 'iCloud Drive backup storage for OpenTV'
  s.description    = 'Reads and writes the OpenTV backup in the app\'s iCloud Drive container.'
  s.author         = 'Insightfy LLC'
  s.homepage       = 'https://github.com/insightfy/opentv'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end
