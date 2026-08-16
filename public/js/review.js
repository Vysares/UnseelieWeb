/* ============================================================
   Unseelie Workshop — Review form

   Reads the invite token from the URL, asks the API what is still
   reviewable on that order, and posts one review at a time.

   The ?r= parameter comes from the star links in the email. It only
   preselects a radio — the click that carried it is not a submission,
   and the rating stays changeable. Mail scanners follow every link in
   an inbound message; if arriving here counted as a review, the site
   would fill up with reviews written by antivirus software.
   ============================================================ */

(function () {
    'use strict';

    var INVITE_URL = '/api/reviews/invite';
    var SUBMIT_URL = '/api/reviews/submit';
    var MAX_RATING = 5;
    var BODY_MIN = 20;
    var BODY_MAX = 2000;

    var RATING_WORDS = ['', 'Poor', 'Not great', 'Fine', 'Good', 'Excellent'];

    var TYPE_LABELS = {
        'wrist-cuffs': 'Wrist Cuffs',
        'ankle-cuffs': 'Ankle Cuffs',
        'collars': 'Collar',
        'sets': 'Full Set',
        'accessories': 'Accessory'
    };

    var COLLECTION_LABELS = {
        classic: 'Classic',
        nightshade: 'Nightshade',
        regent: 'Regent'
    };

    var el = {};
    var token = null;

    document.addEventListener('DOMContentLoaded', function () {
        cacheElements();

        var params = new URLSearchParams(window.location.search);
        token = params.get('t');

        buildStars(readRating(params.get('r')));
        wireCounter();
        wireSubmit();

        loadInvite();
    });

    function cacheElements() {
        [
            'review-loading', 'review-problem', 'review-problem-title',
            'review-problem-detail', 'review-complete', 'review-done',
            'review-done-more', 'review-another', 'review-form',
            'review-item-group', 'review-item', 'review-stars',
            'review-stars-caption', 'review-title', 'review-body',
            'review-author', 'review-counter', 'review-error', 'review-submit'
        ].forEach(function (id) {
            el[id] = document.getElementById(id);
        });
    }

    /* ============================================================
       Loading the invite
       ============================================================ */

    function loadInvite() {
        if (!token) {
            showProblem('This link is missing its code',
                'Please use the link exactly as it appeared in your email.');
            return;
        }

        fetch(INVITE_URL + '?t=' + encodeURIComponent(token))
            .then(function (res) {
                return res.json().then(function (data) {
                    return { ok: res.ok, data: data };
                });
            })
            .then(function (result) {
                if (!result.ok) {
                    showProblem('This link will not open', result.data.error || 'Please try again later.');
                    return;
                }
                if (result.data.complete) {
                    show(el['review-complete']);
                    return;
                }
                populateItems(result.data.items);
                show(el['review-form']);
            })
            .catch(function () {
                showProblem('We could not reach the workshop',
                    'Something went wrong at our end. Please try again in a few minutes.');
            });
    }

    /* Only unreviewed pieces are offered. The chooser is hidden when
       there is nothing to choose between. */
    function populateItems(items) {
        var pending = items.filter(function (item) { return !item.reviewed; });

        el['review-item'].innerHTML = pending.map(function (item) {
            return '<option value="' + escapeAttr(item.id) + '">' +
                escapeHtml(describeItem(item)) + '</option>';
        }).join('');

        el['review-item-group'].hidden = pending.length < 2;
    }

    function describeItem(item) {
        var piece = TYPE_LABELS[item.type] || item.type;
        var collection = COLLECTION_LABELS[item.collection];
        var label = collection ? piece + ', ' + collection : piece;
        return item.size ? label + ' — ' + item.size : label;
    }

    /* ============================================================
       Stars
       ============================================================ */

    function readRating(raw) {
        var value = Number(raw);
        if (!Number.isInteger(value) || value < 1 || value > MAX_RATING) return 0;
        return value;
    }

    function buildStars(preselected) {
        var markup = '';

        for (var value = 1; value <= MAX_RATING; value++) {
            var id = 'review-star-' + value;
            markup +=
                '<input type="radio" name="rating" id="' + id + '" value="' + value + '"' +
                (value === preselected ? ' checked' : '') + '>' +
                '<label for="' + id + '" title="' + value + ' of ' + MAX_RATING + '">★</label>';
        }

        el['review-stars'].insertAdjacentHTML('beforeend', markup);
        el['review-stars'].addEventListener('change', paintStars);

        paintStars();
    }

    function paintStars() {
        var chosen = selectedRating();

        Array.prototype.forEach.call(
            el['review-stars'].querySelectorAll('label'),
            function (label, index) {
                label.classList.toggle('is-lit', index < chosen);
            }
        );

        el['review-stars-caption'].textContent = chosen
            ? chosen + ' of ' + MAX_RATING + ' — ' + RATING_WORDS[chosen]
            : 'Choose a rating';
    }

    function selectedRating() {
        var checked = el['review-stars'].querySelector('input:checked');
        return checked ? Number(checked.value) : 0;
    }

    /* ============================================================
       Body counter
       ============================================================ */

    function wireCounter() {
        el['review-body'].addEventListener('input', paintCounter);
        paintCounter();
    }

    function paintCounter() {
        var length = el['review-body'].value.trim().length;

        if (length < BODY_MIN) {
            el['review-counter'].textContent = 'At least ' + BODY_MIN + ' characters (' + length + ' so far)';
        } else {
            el['review-counter'].textContent = length + ' of ' + BODY_MAX + ' characters';
        }

        el['review-counter'].classList.toggle('is-over', length > BODY_MAX);
    }

    /* ============================================================
       Submitting
       ============================================================ */

    function wireSubmit() {
        el['review-form'].addEventListener('submit', function (event) {
            event.preventDefault();
            submitReview();
        });

        el['review-another'].addEventListener('click', function (event) {
            event.preventDefault();
            window.location.reload();
        });
    }

    function submitReview() {
        hideError();

        if (!selectedRating()) {
            showError('Please choose a rating.');
            return;
        }

        setBusy(true);

        fetch(SUBMIT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                orderItemId: el['review-item'].value,
                rating: selectedRating(),
                title: el['review-title'].value,
                body: el['review-body'].value,
                author: el['review-author'].value
            })
        })
            .then(function (res) {
                return res.json().then(function (data) {
                    return { ok: res.ok, data: data };
                });
            })
            .then(function (result) {
                setBusy(false);

                if (result.ok) {
                    showThanks();
                    return;
                }

                /* The server names the words rather than silently
                   dropping the review, so it can be edited and sent
                   again. Nothing is lost from the form. */
                if (result.data.blockedWords) {
                    showError(
                        'Please reword before submitting. These cannot be published: ' +
                        result.data.blockedWords.map(function (word) {
                            return '<strong>' + escapeHtml(word) + '</strong>';
                        }).join(', ') + '.',
                        true
                    );
                    return;
                }

                showError(result.data.error || 'Something went wrong. Please try again.');
            })
            .catch(function () {
                setBusy(false);
                showError('We could not reach the workshop. Please try again in a few minutes.');
            });
    }

    function showThanks() {
        var remaining = el['review-item'].options.length - 1;

        hideAll();
        show(el['review-done']);
        el['review-done-more'].hidden = remaining < 1;
    }

    function setBusy(busy) {
        el['review-submit'].disabled = busy;
        el['review-submit'].textContent = busy ? 'Sending…' : 'Submit Review';
    }

    /* ============================================================
       States
       ============================================================ */

    function hideAll() {
        ['review-loading', 'review-problem', 'review-complete', 'review-done', 'review-form']
            .forEach(function (id) { el[id].hidden = true; });
    }

    function show(node) {
        hideAll();
        node.hidden = false;
    }

    function showProblem(title, detail) {
        el['review-problem-title'].textContent = title;
        el['review-problem-detail'].textContent = detail;
        show(el['review-problem']);
    }

    function showError(message, isHtml) {
        if (isHtml) el['review-error'].innerHTML = message;
        else el['review-error'].textContent = message;

        el['review-error'].hidden = false;
        el['review-error'].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function hideError() {
        el['review-error'].hidden = true;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/'/g, '&#39;');
    }
})();
