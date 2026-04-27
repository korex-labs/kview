package cronjobs

import "testing"

func TestCronScheduleHint(t *testing.T) {
	tests := []struct {
		name     string
		schedule string
		want     string
	}{
		{
			name:     "hourly on top of hour",
			schedule: "0 * * * *",
			want:     "Hourly",
		},
		{
			name:     "hourly at fixed minute",
			schedule: "10 * * * *",
			want:     "Hourly at :10",
		},
		{
			name:     "every two hours",
			schedule: "0 */2 * * *",
			want:     "Every 2 hours",
		},
		{
			name:     "daily schedule",
			schedule: "30 6 * * *",
			want:     "Daily at 06:30",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := cronScheduleHint(tc.schedule)
			if got != tc.want {
				t.Fatalf("cronScheduleHint(%q) = %q, want %q", tc.schedule, got, tc.want)
			}
		})
	}
}

