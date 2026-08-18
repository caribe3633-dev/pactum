/**
 * Smart sector image resolution — name-based, not ID-based.
 * Scales to new sectors without code changes.
 *
 * Priority:
 *   1. localStorage override (getSectorMeta().image)
 *   2. Smart match on sector name (EN + AR keywords)
 *   3. building — final fallback
 */

import buildingImg from '../assets/login-building.png';
import hospitalImg from '../assets/project-hospital.jpg';
import residentialImg from '../assets/project-residential.jpg';
import towerImg from '../assets/project-tower.jpg';
import villasImg from '../assets/project-villas.jpg';
import { getSectorMeta } from './entityMeta';

type SectorImageKey = 'hospital' | 'residential' | 'villas' | 'tower' | 'building';

const IMAGES: Record<SectorImageKey, string> = {
  hospital: hospitalImg,
  residential: residentialImg,
  villas: villasImg,
  tower: towerImg,
  building: buildingImg,
};

/**
 * Ordered rules — first match wins.
 * Keep more specific categories before generic ones.
 */
const RULES: { key: SectorImageKey; keywords: string[] }[] = [
  {
    key: 'hospital',
    keywords: [
      'healthcare', 'health care', 'health', 'hospital', 'medical', 'clinic', 'pharma',
      'صحي', 'صحة', 'مستشفى', 'طبي', 'عيادة', 'رعاية',
    ],
  },
  {
    key: 'villas',
    keywords: [
      'villa', 'villas', 'compound', 'luxury hous',
      'فيلا', 'فلل', 'مجمع سكني',
    ],
  },
  {
    key: 'residential',
    keywords: [
      'residential', 'housing', 'apartment', 'dwelling', 'homes',
      'سكني', 'سكن', 'إسكان', 'اسكان', 'شقق', 'مساكن',
    ],
  },
  {
    key: 'tower',
    keywords: [
      'commercial', 'office', 'tower', 'business', 'retail', 'mall', 'corporate', 'finance',
      'تجاري', 'مكتب', 'مكاتب', 'برج', 'أبراج', 'ابراج', 'أعمال', 'اعمال', 'مول',
    ],
  },
  {
    key: 'building',
    keywords: [
      'industrial', 'manufacturing', 'factory', 'heavy', 'plant', 'refinery', 'energy',
      'infrastructure', 'construction', 'civil', 'road', 'bridge', 'utilities',
      'صناعي', 'صناعة', 'مصنع', 'ثقيل', 'تصنيع', 'طاقة',
      'بنية تحتية', 'بنية', 'إنشاء', 'انشاء', 'إنشاءات', 'انشاءات', 'مدني', 'طرق', 'جسور',
    ],
  },
];

/** Resolve the smart default image for a sector name (no localStorage). */
export function getSectorImageByName(name?: string): string {
  if (!name) return IMAGES.building;

  const n = name.toLowerCase().trim();
  for (const rule of RULES) {
    if (rule.keywords.some(k => n.includes(k))) {
      return IMAGES[rule.key];
    }
  }
  return IMAGES.building;
}

/**
 * Full resolution with localStorage priority.
 * 1. saved image  2. smart name match  3. building
 */
export function getSectorImage(sectorId: string, sectorName?: string): string {
  const saved = getSectorMeta(sectorId).image;
  if (saved) return saved;
  return getSectorImageByName(sectorName);
}

export { IMAGES as SECTOR_IMAGES };
