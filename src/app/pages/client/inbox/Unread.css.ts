import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';

export const UnreadCard = recipe({
  base: {
    padding: config.space.S300,
    cursor: 'pointer',
    transition: 'background-color 0.1s, border-color 0.1s',
  },
  variants: {
    selected: {
      true: {
        // Use a subtle left border indicator like the sidebar
        borderLeft: `${toRem(3)} solid ${color.Secondary.Main}`,
        backgroundColor: color.SurfaceVariant.ContainerHover,
      },
      false: {
        borderLeft: `${toRem(3)} solid transparent`,
      },
    },
  },
  defaultVariants: {
    selected: false,
  },
});
