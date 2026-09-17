import type {
  TCalendarMode,
  TCalendarView,
  TEventColor,
} from '@/components/calendar/types';

export interface IUser {
  id: string;
  name: string;
  picturePath: string | null;
  /**
   * Linked org-member user id (practitioner.userId). Used to place
   * appointments that have no practitionerId but are assignedTo this member.
   */
  userId?: string | null;
  /**
   * Personal calendar tint color. Appointments owned by this user inherit
   * the color; the practitioner's own unavailability stripes inherit it too
   * (via `currentColor`). Null = no personal color, fall back to event.color.
   */
  color?: TEventColor | null;
}

export interface ICalendarLocation {
  id: string;
  name: string | null;
  isPrimary: boolean;
}

export interface IEvent {
  id: string | number;
  startDate: string;
  endDate: string;
  title: string;
  color: TEventColor;
  description: string;
  user: IUser;
  metadata?: Record<string, unknown>;
}

export interface ICalendarCell {
  day: number;
  currentMonth: boolean;
  date: Date;
}

// Calendar configuration for different modes (appointments vs content)
export interface ICalendarConfig {
  mode: TCalendarMode;
  labels: {
    addButton: string;
    dialogTitle: string;
    dialogDescription?: string;
    emptyState: string;
    eventLabel: string; // "Appointment" or "Content"
    eventLabelPlural: string; // "Appointments" or "Content Items"
  };
  // Optional custom form component for add/edit dialogs
  customAddDialog?: React.ComponentType<{
    children?: React.ReactNode;
    startDate?: Date;
    startTime?: { hour: number; minute: number };
    /**
     * Pre-selected practitioner — populated when the add dialog is opened
     * from a per-staff day-view column so the new booking is assigned to
     * that column's staff member.
     */
    practitionerId?: string;
    /**
     * Controlled open state — used by the header "Add" menu to open the
     * appointment dialog without a wrapping trigger element.
     */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }>;
  // Optional secondary add dialog, rendered as an outline button beside the
  // primary add button in the header (e.g. "Add Unavailability"). Also opened
  // programmatically by the time-grid drag-to-create flow with pre-filled
  // start/end times — supports both uncontrolled (trigger via children) and
  // controlled (open / onOpenChange) modes.
  secondaryAddDialog?: React.ComponentType<{
    children?: React.ReactNode;
    startDate?: Date;
    startTime?: { hour: number; minute: number };
    endTime?: { hour: number; minute: number };
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }>;
  secondaryAddButtonLabel?: string;
  customEditDialog?: React.ComponentType<{
    event: IEvent;
    onClose: () => void;
  }>;
  customEventDetailsDialog?: React.ComponentType<{
    event: IEvent;
    children: React.ReactNode;
  }>;
  /**
   * Optional render-prop that replaces the default CalendarHeader on small
   * screens (below the lg breakpoint). Receives the active view and the
   * router basePath so it can navigate between day/week/month/agenda.
   */
  mobileHeader?: (props: {
    view: TCalendarView;
    basePath: string;
  }) => React.ReactNode;
  /**
   * When true, the day view renders one column per visible staff member,
   * with the staff avatar centered above each column. Empty-slot taps pass
   * the column's practitionerId into customAddDialog so the new booking is
   * pre-assigned.
   */
  dayColumnsPerStaff?: boolean;
  /**
   * Popover menu opened by clicking a staff column header in the per-staff
   * day view (shift status, per-person view switches, actions). Receives the
   * column's staff and renders `children` as the trigger.
   */
  staffHeaderMenu?: React.ComponentType<{
    staff: IUser;
    children: React.ReactNode;
  }>;
  // Confirmation dialog for drag-drop rescheduling
  onConfirmDrop?: (params: {
    originalEvent: IEvent;
    updatedEvent: IEvent;
  }) => Promise<{ confirmed: boolean; options?: Record<string, unknown> }>;
  // Callbacks for CRUD operations
  onCreateEvent?: (event: Omit<IEvent, 'id'>) => Promise<void>;
  onUpdateEvent?: (
    event: IEvent,
    options?: Record<string, unknown>
  ) => Promise<void>;
  onDeleteEvent?: (event: IEvent) => Promise<void>;
  onEventClick?: (event: IEvent) => void;
  // Optional custom filter for user select dropdown (overrides default event.user.id === selectedUserId)
  eventFilter?: (event: IEvent, selectedUserId: string) => boolean;
  /**
   * Labels/options for the header resource multi-select (team members for
   * appointments, pages for the content planner). Defaults to team labels.
   */
  resourceSelect?: {
    /** Preset that selects everything, e.g. "All team" / "All pages". */
    allLabel: string;
    /** "Scheduled" preset label (shift-based). Omit to hide the preset. */
    scheduledLabel?: string;
    searchPlaceholder?: string;
    /** Plural noun for the count label, e.g. "team members" / "pages". */
    countNoun?: string;
  };
  // Optional actions rendered in the header (e.g. sync button)
  headerActions?: React.ReactNode;

  /**
   * The Staff ⇄ Rooms axis switch, rendered immediately after the team /
   * resource picker.
   *
   * It has to sit in the SAME place on both calendars: it exists on each and
   * means the same thing, so a toggle that moves between them jumps out from
   * under the cursor that just clicked it. Anchoring it to the picker rather
   * than to the tail of `headerActions` is what fixes that — `headerActions`
   * is sized by whatever the calendar puts in it (a category switcher that
   * grows a button per category), so anything at its tail slides sideways.
   *
   * Beside the picker, and not over with the view controls: "which rows am I
   * looking at" is the same question the picker answers, and the far end of
   * the toolbar is where the view and Add controls live.
   */
  headerAxisToggle?: React.ReactNode;

  /**
   * Extra rows rendered inside the event-details dialog body, under the
   * built-in fields.
   *
   * Exists so a host can attach domain detail to a booking without forking the
   * dialog — the rooms feature uses it to show which room a booking holds and
   * let staff change it by clicking the booking, on BOTH the staff and rooms
   * axes. Receives the event; renders nothing when the host omits it.
   */
  eventDetailsExtra?: React.ComponentType<{ event: IEvent }>;
  /** Base path for nested calendar views (month/day/week/agenda/year), e.g. `/dashboard/appointments`. */
  routerBasePath?: string;
  /**
   * When true, clicking a day cell in the month view navigates to that day's
   * view (all practitioners) instead of opening the add dialog. Used by the
   * appointments calendar; the content planner keeps the add-on-click flow.
   */
  navigateToDayOnMonthCellClick?: boolean;
}

// Default configurations
export const APPOINTMENTS_CONFIG: ICalendarConfig = {
  mode: 'appointments',
  labels: {
    addButton: 'Add Appointment',
    dialogTitle: 'Add New Appointment',
    dialogDescription: 'Schedule a new appointment with a lead.',
    emptyState: 'No appointments scheduled',
    eventLabel: 'Appointment',
    eventLabelPlural: 'Appointments',
  },
};

export const CONTENT_CONFIG: ICalendarConfig = {
  mode: 'content',
  labels: {
    addButton: 'Schedule Content',
    dialogTitle: 'Schedule New Content',
    dialogDescription: 'Schedule content for publishing.',
    emptyState: 'No content scheduled',
    eventLabel: 'Content',
    eventLabelPlural: 'Content Items',
  },
};
