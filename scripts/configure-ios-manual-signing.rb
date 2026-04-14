#!/usr/bin/env ruby

require 'xcodeproj'

project_path = ENV.fetch('XCODE_PROJECT_PATH')
team_id = ENV.fetch('APPLE_TEAM_ID')
main_bundle_id = ENV.fetch('IOS_MAIN_BUNDLE_ID')
main_profile_name = ENV.fetch('IOS_MAIN_PROFILE_NAME')
main_profile_uuid = ENV.fetch('IOS_MAIN_PROFILE_UUID')
widget_bundle_id = ENV.fetch('IOS_WIDGET_BUNDLE_ID')
widget_profile_name = ENV.fetch('IOS_WIDGET_PROFILE_NAME')
widget_profile_uuid = ENV.fetch('IOS_WIDGET_PROFILE_UUID')

project = Xcodeproj::Project.open(project_path)

targets_by_bundle_id = {
  main_bundle_id => [main_profile_name, main_profile_uuid],
  widget_bundle_id => [widget_profile_name, widget_profile_uuid],
}

project.targets.each do |target|
  target.build_configurations.each do |config|
    next unless config.name == 'Release'

    bundle_id = config.build_settings['PRODUCT_BUNDLE_IDENTIFIER']
    next unless bundle_id

    profile = targets_by_bundle_id[bundle_id]
    next unless profile

    profile_name, profile_uuid = profile

    config.build_settings['DEVELOPMENT_TEAM'] = team_id
    config.build_settings['CODE_SIGN_STYLE'] = 'Manual'
    config.build_settings['CODE_SIGN_IDENTITY'] = 'iPhone Distribution'
    config.build_settings['CODE_SIGN_IDENTITY[sdk=iphoneos*]'] = 'iPhone Distribution'
    config.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = profile_name
    config.build_settings['PROVISIONING_PROFILE'] = profile_uuid
  end

  next unless targets_by_bundle_id.values.any?

  attributes = project.root_object.attributes['TargetAttributes'] ||= {}
  target_attributes = attributes[target.uuid] ||= {}
  if target.build_configurations.any? { |config| targets_by_bundle_id.key?(config.build_settings['PRODUCT_BUNDLE_IDENTIFIER']) }
    target_attributes['DevelopmentTeam'] = team_id
    target_attributes['ProvisioningStyle'] = 'Manual'
  end
end

project.save
