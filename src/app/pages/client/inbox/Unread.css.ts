import { recipe } from '@vanilla-extract/recipes';
import { color, config } from 'folds';

export const UnreadCard = recipe({
  base: {
    padding: config.space.S300,
    cursor: 'pointer',
    transition: 'background-color 0.1s',
  },
  variants: {
    selected: {
      true: {
        outline: `2px solid ${color.Primary.Main}`,
        outlineOffset: '-2px',
      },
      false: {},
    },
  },
  defaultVariants: {
    selected: false,
  },
});
