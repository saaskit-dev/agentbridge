Pod::Spec.new do |s|
  s.name = 'FocusAudioNative'
  s.version = '1.0.0'
  s.summary = 'Native iOS focus audio playback for Free'
  s.description = 'Provides AVAudioSession and AVQueuePlayer based focus audio playback for the Free app.'
  s.license = 'MIT'
  s.author = 'saaskit-dev'
  s.homepage = 'https://github.com/saaskit-dev/agentbridge'
  s.platforms = {
    :ios => '15.1'
  }
  s.swift_version = '5.9'
  s.source = { path: '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
