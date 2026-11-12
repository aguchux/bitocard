import { StyleSheet, Text, type TextProps } from 'react-native';

import { type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Inter, as udozo.com: the families the app loads in its root layout. */
export const inter = { regular: 'Inter_400Regular', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold', extrabold: 'Inter_800ExtraBold' } as const;

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'subtitle' | 'heading' | 'small' | 'smallBold' | 'caption' | 'link' | 'price';
  themeColor?: ThemeColor;
};

/** Text in the theme's colours; it scales with the phone's text size. */
export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const color = theme[themeColor ?? (type === 'link' ? 'link' : type === 'caption' ? 'textSecondary' : 'text')];
  return <Text style={[{ color }, styles[type], style]} {...rest} />;
}

const styles = StyleSheet.create({
  default: { fontFamily: inter.regular, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: inter.regular, fontSize: 13, lineHeight: 18 },
  smallBold: { fontFamily: inter.bold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: inter.regular, fontSize: 12, lineHeight: 16 },
  title: { fontFamily: inter.extrabold, fontSize: 28, lineHeight: 34 },
  subtitle: { fontFamily: inter.extrabold, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: inter.bold, fontSize: 17, lineHeight: 22 },
  link: { fontFamily: inter.semibold, fontSize: 15, lineHeight: 22 },
  price: { fontFamily: inter.extrabold, fontSize: 17, lineHeight: 22 },
});
