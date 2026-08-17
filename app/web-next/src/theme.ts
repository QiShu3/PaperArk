import type { ThemeConfig } from 'antd';

// 固定日间主题（已全面取消夜间模式，不再跟随系统 prefers-color-scheme）
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
