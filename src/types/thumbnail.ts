export interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

export interface ThumbnailSet {
  id: string;
  small?: Thumbnail;
  medium?: Thumbnail;
  large?: Thumbnail;
  source?: Thumbnail;
}

export interface ThumbnailRecord {
  id: string;
  item_id: string;
  size: string;
  width: number;
  height: number;
  path: string;
  mime_type: string;
  generated_at: string;
}

export const THUMBNAIL_SIZES = {
  small: 96,
  medium: 176,
  large: 800
} as const;

export type ThumbnailSizeName = keyof typeof THUMBNAIL_SIZES;

export const SUPPORTED_THUMBNAIL_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff'
];
