export type ThemeMode = 'light' | 'dark';

export type Theme = typeof lightTheme;

export const lightTheme = {
  colors: {
    background: '#FFFFFF',
    surface: '#F2F2F7',
    surfaceLight: '#FFFFFF',
    primary: '#007AFF',
    primaryLight: '#3395FF',
    accent: '#5856D6',
    text: '#000000',
    textSecondary: '#6B7280',
    success: '#34C759',
    danger: '#FF3B30',
    border: '#D1D1D6'
  },
  spacing: {
    xs: 4,
    s: 8,
    m: 16,
    l: 24,
    xl: 32,
    xxl: 48
  },
  text: {
    title: {
      fontSize: 32,
      fontWeight: '800' as const,
      color: '#000000',
      letterSpacing: -0.5
    },
    subtitle: {
      fontSize: 18,
      fontWeight: '600' as const,
      color: '#000000'
    },
    body: {
      fontSize: 16,
      color: '#000000',
      lineHeight: 22
    },
    caption: {
      fontSize: 14,
      color: '#6B7280'
    }
  },
  shadows: {
    soft: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 5
    }
  }
} as const;

export const darkTheme = {
  colors: {
    background: '#000000',
    surface: '#121212',
    surfaceLight: '#1E1E1E',
    primary: '#0A84FF',
    primaryLight: '#3395FF',
    accent: '#5856D6',
    text: '#FFFFFF',
    textSecondary: '#A1A1A6',
    success: '#34C759',
    danger: '#FF453A',
    border: '#2C2C2E'
  },
  spacing: lightTheme.spacing,
  text: {
    title: {
      fontSize: 32,
      fontWeight: '800' as const,
      color: '#FFFFFF',
      letterSpacing: -0.5
    },
    subtitle: {
      fontSize: 18,
      fontWeight: '600' as const,
      color: '#FFFFFF'
    },
    body: {
      fontSize: 16,
      color: '#FFFFFF',
      lineHeight: 22
    },
    caption: {
      fontSize: 14,
      color: '#A1A1A6'
    }
  },
  shadows: {
    soft: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 5
    }
  }
} as const;

export function getTheme(mode: ThemeMode) {
  return mode === 'dark' ? darkTheme : lightTheme;
}
