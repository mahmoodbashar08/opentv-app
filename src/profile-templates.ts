/**
 * PROFILE TEMPLATES (8 Oct) — one tap puts a whole look on the profile: a
 * banner, the theme's two colours (and with them the page's gradient), the
 * layout, and an arrangement of blocks. Everything a template sets is a
 * setting the person could have chosen by hand, and every one of them stays
 * editable afterwards.
 *
 * THE BANNERS ARE OUR OWN ARTWORK, drawn for this (`assets/templates/*.jpg`):
 * no show's backdrop, so nothing here is anybody else's picture.
 *
 * Plus, because every part of it is: the theme, the layouts beyond classic and
 * the arrangement are all Plus already, and the server enforces the first two.
 */
import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";

import { appearanceChanged } from "@/community-appearance";
import {
  pushProfileLayout,
  pushProfileTheme,
  pushWidgets,
} from "@/community-profiles";
import type { ProfileLayout } from "@/components/profile-template";
import { widgetValue } from "@/components/profile-widgets";
import { profileThemeChanged } from "@/cover-frame-live";
import { getMeta, getProfileLayout, setMeta, setProfileLayout } from "@/db";
import {
  notifyLayoutSaved,
  publishableWidgets,
  serialise,
  SHELF_PREFIX,
  specOf,
  type Placed,
  type WidgetSpan,
} from "@/profile-layout";
import { CENTRE_FRAME, coverFrameString } from "@/pure";
import { setThemeAccentHex } from "@/theme";

/** A block: an id at its default size, `id:span` for another size, or a pair of squares. */
type Block = string | readonly [string, string];
/** Where the profile's shelves (shows, favourites, films) go. */
const SHELVES = "SHELVES";

export type Template = {
  id: string;
  banner: number;
  primary: string;
  secondary: string;
  layout: ProfileLayout;
  blocks: readonly Block[];
};

export const TEMPLATES: readonly Template[] = [
  {
    id: "midnight",
    banner: require("@/assets/templates/midnight.jpg"),
    primary: "#8B5CF6",
    secondary: "#22D3EE",
    layout: "cards",
    blocks: [
      "banners",
      "intro",
      "counts",
      "nowWatching:2x2",
      ["streak", "thisYear"],
      "stats",
      SHELVES,
      "activity:2x2",
      "lists",
      "extra",
    ],
  },
  {
    id: "sunset",
    banner: require("@/assets/templates/sunset.jpg"),
    primary: "#F97316",
    secondary: "#EC4899",
    layout: "poster",
    blocks: [
      "banners",
      "intro",
      "counts",
      "topRated:2x2",
      SHELVES,
      ["since", "finished"],
      "stats",
      "lists",
      "extra",
    ],
  },
  {
    id: "neon",
    banner: require("@/assets/templates/neon.jpg"),
    primary: "#D946EF",
    secondary: "#22D3EE",
    layout: "cards",
    blocks: [
      "banners",
      "intro",
      "counts",
      ["streak", "binge"],
      "emotions:2x1",
      "stats",
      "activity:2x2",
      SHELVES,
      "lists",
      "extra",
    ],
  },
  {
    id: "forest",
    banner: require("@/assets/templates/forest.jpg"),
    primary: "#22C55E",
    secondary: "#A3E635",
    layout: "classic",
    blocks: [
      "banners",
      "intro",
      "counts",
      ["genre", "thisYear"],
      "stats",
      SHELVES,
      "lists",
      "extra",
    ],
  },
  {
    id: "ocean",
    banner: require("@/assets/templates/ocean.jpg"),
    primary: "#06B6D4",
    secondary: "#3B82F6",
    layout: "cards",
    blocks: [
      "banners",
      "intro",
      "counts",
      "timeline",
      SHELVES,
      ["genre", "character"],
      "stats",
      "lists",
      "extra",
    ],
  },
  {
    id: "cinema",
    banner: require("@/assets/templates/cinema.jpg"),
    primary: "#E11D48",
    secondary: "#F59E0B",
    layout: "poster",
    blocks: [
      "banners",
      "intro",
      "counts",
      "topRated:2x2",
      ["rated", "finished"],
      SHELVES,
      "stats",
      "lists",
      "extra",
    ],
  },
  {
    id: "noir",
    banner: require("@/assets/templates/noir.jpg"),
    primary: "#A1A1AA",
    secondary: "#E4E4E7",
    layout: "classic",
    blocks: ["banners", "intro", "counts", SHELVES, "stats", "extra"],
  },
  {
    id: "gold",
    banner: require("@/assets/templates/gold.jpg"),
    primary: "#EAB308",
    secondary: "#F59E0B",
    layout: "poster",
    blocks: [
      "banners",
      "intro",
      "counts",
      ["since", "thisYear"],
      "topRated:2x1",
      "stats",
      SHELVES,
      "lists",
      "extra",
    ],
  },
  {
    id: "pastel",
    banner: require("@/assets/templates/pastel.jpg"),
    primary: "#C084FC",
    secondary: "#FDA4AF",
    layout: "cards",
    blocks: [
      "banners",
      "intro",
      "counts",
      "emotions:2x1",
      "emotionCalendar:2x2",
      SHELVES,
      "lists",
      "extra",
    ],
  },
  {
    id: "retro",
    banner: require("@/assets/templates/retro.jpg"),
    primary: "#F59E0B",
    secondary: "#B45309",
    layout: "classic",
    blocks: [
      "banners",
      "intro",
      "counts",
      ["streak", "binge"],
      "activity:2x1",
      SHELVES,
      "stats",
      "lists",
      "extra",
    ],
  },
];

/** The same four the profile tab draws (see `(tabs)/profile.tsx`). */
const SHELF_KEYS = ["shows", "fav-shows", "movies", "fav-movies"];

/** The template's blocks as an arrangement, in order, each at its size. */
export function templateItems(tpl: Template): Placed[] {
  // `id:span` — never applied to a shelf, whose own id has a colon in it.
  const one = (ref: string): Placed => {
    const [id, span] = ref.split(":") as [string, WidgetSpan | undefined];
    return { uid: id, id, span: span ?? specOf(id).span };
  };
  return tpl.blocks.flatMap((b): Placed[] =>
    b === SHELVES
      ? SHELF_KEYS.map((k) => ({
          uid: SHELF_PREFIX + k,
          id: SHELF_PREFIX + k,
          span: specOf(SHELF_PREFIX + k).span,
        }))
      : typeof b === "string"
        ? [one(b)]
        : b.map(one),
  );
}

/**
 * Put the template on the profile. THE SERVER FIRST for the two it checks —
 * colour and layout — so a refused one changes nothing on the phone; then the
 * banner, the frame and the blocks. Throws what the server threw.
 */
export async function applyTemplate(tpl: Template): Promise<void> {
  await pushProfileTheme(tpl.primary);
  await pushProfileLayout(tpl.layout === "classic" ? null : tpl.layout);

  setMeta("profileThemeColor", tpl.primary);
  setMeta("profileThemeSecondary", tpl.secondary);
  setMeta("profileThemeName", "");
  setMeta("profileThemeLayout", tpl.layout);
  setThemeAccentHex(tpl.primary);

  // The banner: copied into Documents like every banner, so it publishes
  // through the same upload path a photo from the library uses.
  const asset = await Asset.fromModule(tpl.banner).downloadAsync();
  const name = `profile-cover-${Date.now()}.jpg`;
  new File(asset.localUri ?? asset.uri).copy(new File(Paths.document, name));
  const old = getMeta("coverFile");
  if (old) {
    try {
      const f = new File(Paths.document, old);
      if (f.exists) f.delete();
    } catch {}
  }
  setMeta("coverFile", name);
  setMeta("coverUrl", "");
  setMeta("coverStillFile", "");
  // The banner melts into the page's gradient instead of ending on a line.
  setMeta(
    "coverFrame",
    coverFrameString({ ...CENTRE_FRAME, fade: true, strength: 0.8 }),
  );

  const items = templateItems(tpl);
  setProfileLayout(serialise(items, getProfileLayout()));
  notifyLayoutSaved();
  void pushWidgets(
    JSON.stringify(
      publishableWidgets(items, (id, span, data) =>
        widgetValue(id, span, data),
      ),
    ),
  ).catch(() => {});

  profileThemeChanged();
  appearanceChanged();
}
