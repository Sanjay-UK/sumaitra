function getNavScrollOffset() {
    const navbar = document.querySelector('.navbar');
    return (navbar ? navbar.offsetHeight : 92) + 24;
}

function scrollToSection(target, smooth) {
    if (!target) {
        return;
    }

    const top = target.getBoundingClientRect().top + window.scrollY - getNavScrollOffset();
    window.scrollTo({
        top,
        behavior: smooth ? 'smooth' : 'instant'
    });
}

function initAnchorScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener('click', (event) => {
            const hash = link.getAttribute('href');

            if (!hash || hash === '#') {
                return;
            }

            const target = document.querySelector(hash);

            if (!target) {
                return;
            }

            event.preventDefault();
            scrollToSection(target, true);
            history.pushState(null, '', hash);
        });
    });

    if (location.hash) {
        const target = document.querySelector(location.hash);

        if (target) {
            requestAnimationFrame(() => {
                scrollToSection(target, false);
            });
        }
    }
}

// Dynamic Navbar styling on scroll
window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 50) {
        navbar.style.background = 'rgba(10, 5, 20, 0.95)';
        navbar.style.boxShadow = '0 4px 24px rgba(0, 0, 0, 0.35)';
        navbar.style.backdropFilter = 'blur(16px)';
    } else {
        navbar.style.background = 'rgba(10, 5, 20, 0.85)';
        navbar.style.boxShadow = 'none';
        navbar.style.backdropFilter = 'blur(16px)';
    }
});

// Subtle Card entrance animations using Intersection Observer
document.addEventListener("DOMContentLoaded", () => {
    initAnchorScroll();

    const observerOptions = {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                // adding a staggered delay
                setTimeout(() => {
                    entry.target.style.opacity = "1";
                    entry.target.style.transform = "translateY(0)";
                }, index * 100); // 100ms stagger between cards
                observer.unobserve(entry.target); // only animate once
            }
        });
    }, observerOptions);

    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        // Initial state set in js so users without js still see them
        card.style.opacity = "0";
        card.style.transform = "translateY(40px)";
        card.style.transition = "all 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)";
        observer.observe(card);
    });

    const inquiryForm = document.getElementById('inquiry-form');
    if (inquiryForm) {
        inquiryForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const feedback = document.getElementById('inquiry-feedback');
            const submitBtn = document.getElementById('inquiry-submit');

            feedback.hidden = true;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';

            const formData = new FormData(inquiryForm);
            const payload = {
                name: formData.get('name'),
                email: formData.get('email'),
                subject: formData.get('subject'),
                message: formData.get('message')
            };

            try {
                const response = await fetch(apiUrl('/api/inquiries'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (!response.ok) {
                    feedback.textContent = data.error || 'Unable to send your message.';
                    feedback.className = 'form-feedback form-feedback-error';
                    feedback.hidden = false;
                    return;
                }

                inquiryForm.reset();
                feedback.textContent = data.message || 'Message sent successfully!';
                feedback.className = 'form-feedback form-feedback-success';
                feedback.hidden = false;
            } catch (error) {
                const serverHint = window.location.protocol === 'file:'
                    ? ' Start the server with "node server.js" and open http://localhost:3000'
                    : '';
                feedback.textContent = `Unable to connect to the server.${serverHint}`;
                feedback.className = 'form-feedback form-feedback-error';
                feedback.hidden = false;
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send Message';
            }
        });
    }
});
