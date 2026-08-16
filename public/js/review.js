/* ============================================================
   Unseelie Workshop — Review form

   Reads the invite token from the URL and asks the API which piece it
   was issued for. One token means one item, so the page never has to
   ask which thing is being reviewed — an order with three pieces sends
   three links.

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
    var LANGUAGE_URL = '/api/reviews/language';
    var MAX_RATING = 5;
    var BODY_MIN = 20;
    var BODY_MAX = 2000;

    /* Built from the list the server hands over, so there is one word
       list rather than two that drift apart. Null until it arrives; the
       server checks again on submit either way, so a slow or failed
       fetch costs nothing but the early warning. */
    var languagePattern = null;

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
        wireLanguageWatch();

        loadInvite();
        loadLanguageList();
    });

    /* ============================================================
       Language

       Catches a word before the customer presses Submit, so nothing
       they wrote is ever sent and handed back to them. The house rule
       is stated plainly; what it applies to is a short list of slurs,
       not opinions, and a scathing review passes untouched.
       ============================================================ */

    function loadLanguageList() {
        fetch(LANGUAGE_URL)
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
                if (!data || !data.words || data.words.length === 0) return;
                languagePattern = new RegExp('\\b(' + data.words.join('|') + ')\\b', 'gi');
                checkLanguage();
            })
            .catch(function () { /* Server still checks on submit. */ });
    }

    function wireLanguageWatch() {
        ['review-title', 'review-body', 'review-author'].forEach(function (id) {
            el[id].addEventListener('input', checkLanguage);
        });
    }

    function findFlaggedWords() {
        if (!languagePattern) return [];

        var text = [
            el['review-title'].value,
            el['review-body'].value,
            el['review-author'].value
        ].join('\n');

        var found = [];
        var match;

        languagePattern.lastIndex = 0;
        while ((match = languagePattern.exec(text)) !== null) {
            var word = match[1].toLowerCase();
            if (found.indexOf(word) === -1) found.push(word);
        }

        return found;
    }

    /* Runs on every keystroke: the notice and the greyed-out button
       appear as the word is typed and clear as it is removed, so the
       fix is obvious and nothing is ever sent to be handed back. */
    function checkLanguage() {
        var flagged = findFlaggedWords();

        el['review-submit'].disabled = flagged.length > 0;

        if (flagged.length === 0) {
            el['review-reword'].hidden = true;
            return;
        }

        el['review-reword'].innerHTML =
            'We can\'t allow the following language to be published publicly: ' +
            flagged.map(function (word) {
                return '<em>' + escapeHtml(word) + '</em>';
            }).join(', ');

        el['review-reword'].hidden = false;
    }

    function cacheElements() {
        [
            'review-loading', 'review-problem', 'review-problem-title',
            'review-problem-detail', 'review-complete', 'review-done',
            'review-form', 'review-piece', 'review-stars',
            'review-stars-caption', 'review-title', 'review-body',
            'review-author', 'review-counter', 'review-error', 'review-reword',
            'review-submit'
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
                if (result.data.reviewed) {
                    show(el['review-complete']);
                    return;
                }
                el['review-piece'].textContent = describeItem(result.data.item);
                show(el['review-form']);
            })
            .catch(function () {
                showProblem('We could not reach the workshop',
                    'Something went wrong at our end. Please try again in a few minutes.');
            });
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
    }

    function submitReview() {
        hideError();

        if (!selectedRating()) {
            showError('Please choose a rating.');
            return;
        }

        /* The button is greyed out while a flagged word is present, so
           this only catches a stray Enter key. Nothing is sent: the form
           keeps every word of it and the customer changes one. */
        if (findFlaggedWords().length > 0) {
            checkLanguage();
            el['review-reword'].scrollIntoView({ block: 'center', behavior: 'smooth' });
            return;
        }

        setBusy(true);

        fetch(SUBMIT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
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
        show(el['review-done']);
    }

    /* Finishing a send must not undo the language block, or a failed
       submit would hand back an enabled button on flagged text. */
    function setBusy(busy) {
        el['review-submit'].disabled = busy || findFlaggedWords().length > 0;
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
