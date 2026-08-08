import { theme, type ThemeConfig } from 'antd';

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1f1f1f',
    colorInfo: '#1f1f1f',
    colorTextBase: '#141414',
    colorBgLayout: '#fafafa',
    borderRadius: 8,
    fontSize: 14,
  },
  components: {
    Layout: {
      headerBg: 'transparent',
      siderBg: '#ffffff',
      bodyBg: '#ffffff',
    },
  },
};

export const appThemeDark: ThemeConfig = {
  ...appTheme,
  algorithm: theme.darkAlgorithm,
  token: {
    ...appTheme.token,
    colorPrimary: '#f5f5f5',
    colorInfo: '#f5f5f5',
    colorBgLayout: '#141414',
  },
  components: {
    Layout: {
      headerBg: 'transparent',
      siderBg: '#1f1f1f',
      bodyBg: '#141414',
    },
  },
};

export function getThemeConfig(dark: boolean): ThemeConfig {
  return dark ? appThemeDark : appTheme;
}
