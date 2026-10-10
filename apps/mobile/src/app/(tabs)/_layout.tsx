import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Palette } from '@/constants/theme';

export default function TabsLayout() {
  return (
    <NativeTabs backgroundColor={Palette.paper} indicatorColor={Palette.paperDark} labelStyle={{ selected: { color: Palette.ink } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Mapa</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="map" md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="nearby">
        <NativeTabs.Trigger.Label>W pobliżu</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="location" md="near_me" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="about">
        <NativeTabs.Trigger.Label>O projekcie</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="info.circle" md="info" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
