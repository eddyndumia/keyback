// Keyback theme: Cloudscape (AWS's open-source design system) with a purple accent.
import { applyTheme } from '@cloudscape-design/components/theming'

export const PURPLE = {
  700: '#4b1fa8',
  600: '#5b2bc9',
  500: '#6d3ee0',
  300: '#b59cf5',
  100: '#efe9fd',
}

const both = (light: string, dark: string) => ({ light, dark })

applyTheme({
  theme: {
    tokens: {
      colorBackgroundButtonPrimaryDefault: both(PURPLE[600], PURPLE[300]),
      colorBackgroundButtonPrimaryHover: both(PURPLE[700], '#cbb9fa'),
      colorBackgroundButtonPrimaryActive: both(PURPLE[700], '#cbb9fa'),
      colorBorderButtonNormalDefault: both(PURPLE[600], PURPLE[300]),
      colorBorderButtonNormalHover: both(PURPLE[700], '#cbb9fa'),
      colorBorderButtonNormalActive: both(PURPLE[700], '#cbb9fa'),
      colorTextButtonNormalDefault: both(PURPLE[600], PURPLE[300]),
      colorTextButtonNormalHover: both(PURPLE[700], '#cbb9fa'),
      colorTextButtonNormalActive: both(PURPLE[700], '#cbb9fa'),
      colorBackgroundButtonNormalHover: both(PURPLE[100], '#2a2145'),
      colorBackgroundButtonNormalActive: both(PURPLE[100], '#2a2145'),
      colorTextLinkDefault: both(PURPLE[600], PURPLE[300]),
      colorTextLinkHover: both(PURPLE[700], '#cbb9fa'),
      colorTextAccent: both(PURPLE[600], PURPLE[300]),
      colorTextInteractiveActive: both(PURPLE[700], '#cbb9fa'),
      colorBorderItemFocused: both(PURPLE[500], PURPLE[300]),
      colorBorderItemSelected: both(PURPLE[600], PURPLE[300]),
      colorBackgroundItemSelected: both(PURPLE[100], '#2a2145'),
      colorBackgroundControlChecked: both(PURPLE[600], PURPLE[300]),
      colorBackgroundSegmentActive: both(PURPLE[600], PURPLE[300]),
      colorBackgroundProgressBarValueDefault: both(PURPLE[600], PURPLE[300]),
      colorTextStatusInfo: both(PURPLE[600], PURPLE[300]),
      colorTextBreadcrumbCurrent: both('#5f6b7a', '#8d99a8'),
    },
  },
})
