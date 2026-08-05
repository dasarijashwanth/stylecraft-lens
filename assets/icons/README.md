# Brand icons

Drop supplied StyleCraft brand SVG icons here, then wire each one into
`components/ui/Icon.tsx`'s `BRAND_ICONS` map:

```ts
import scMark from "@/assets/icons/sc-mark.svg";
// ...
const BRAND_ICONS: Record<string, StaticImageData> = {
  "sc-mark": scMark,
};
```

Every existing `<Icon name="..." fallback={SomeLucideIcon} />` call site then
automatically renders the real brand SVG instead of its Lucide fallback —
no other code changes needed. Until a name has a real entry here, `<Icon>`
always renders `fallback`.
