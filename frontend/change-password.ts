import { getSupabase, getSession } from './src/auth';

// Guard: must be logged in to access this page
const session = getSession();
if (!session) {
  window.location.href = '/landing.html';
}

const form = document.getElementById('changeForm') as HTMLFormElement;
const newPassword = document.getElementById('newPassword') as HTMLInputElement;
const confirmPassword = document.getElementById('confirmPassword') as HTMLInputElement;
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const message = document.getElementById('message') as HTMLDivElement;
const strengthFill = document.getElementById('strengthFill') as HTMLDivElement;

function getStrength(pw: string): { score: number; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#c5f04e'];
  return { score, color: colors[Math.min(score - 1, 4)] || '#ff3b30' };
}

newPassword.addEventListener('input', () => {
  const { score, color } = getStrength(newPassword.value);
  strengthFill.style.width = `${(score / 5) * 100}%`;
  strengthFill.style.background = color;
});

function validate(pw: string, confirm: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[0-9]/.test(pw)) return 'Password must include at least one number.';
  if (!/[^a-zA-Z0-9]/.test(pw)) return 'Password must include at least one special character.';
  if (pw !== confirm) return 'Passwords do not match.';
  return null;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const validationError = validate(newPassword.value, confirmPassword.value);
  if (validationError) {
    message.style.display = 'block';
    message.style.color = '#ff3b30';
    message.style.background = 'rgba(255,59,48,0.08)';
    message.textContent = validationError;
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    // Update password and clear the must_change_password flag
    const { error } = await getSupabase().auth.updateUser({
      password: newPassword.value,
      data: { must_change_password: false }
    });

    if (error) throw error;

    message.style.display = 'block';
    message.style.color = '#c5f04e';
    message.style.background = 'rgba(197,240,78,0.08)';
    message.textContent = 'Password updated! Entering your library...';

    setTimeout(() => {
      window.location.href = '/index.html';
    }, 800);
  } catch (err: any) {
    message.style.display = 'block';
    message.style.color = '#ff3b30';
    message.style.background = 'rgba(255,59,48,0.08)';
    message.textContent = err.message || 'Failed to update password. Please try again.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Set Password & Enter App';
  }
});
