export type Candidate = { user_id: number; name: string; is_chief: boolean; assigned_elsewhere: string | null };
export type AssignedRef = {
  user_id: number;
  name: string;
  is_chief: boolean;
  role: string | null;
  refereed: number | null;
  scored: number | null;
};
export type DayDetail = {
  id: number;
  date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  slot_label: string;
  referees_required: number | null;
  required: number;
  open: boolean;
  available_count: number;
  assigned_count?: number;
  candidates: Candidate[];
  assignments: AssignedRef[];
};
export type TournamentDetail = {
  id: number;
  name: string;
  location: string;
  categories: string[];
  referees_required: number;
  is_visible: boolean;
  has_roles: boolean;
  roles: string[];
  notes: string;
  days: DayDetail[];
};
