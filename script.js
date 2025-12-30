document.addEventListener('DOMContentLoaded', () => {

    // =========================================
    // GLOBAL STATE & API CONFIGURATION
    // =========================================
    let currentUploadedUrl = null;
    const USER_ID = 'DObRu1vyStbUynoQmTcHBlhs55z2'; // User ID for API calls
    const EFFECT_ID = 'stencilMaker';
    const MODEL_TYPE = 'image-effects';
    
    // =========================================
    // API HELPER FUNCTIONS
    // =========================================

    // Generate nanoid for unique filename
    function generateNanoId(length = 21) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Upload file to CDN storage (called immediately when file is selected)
    async function uploadFile(file) {
        const fileExtension = file.name.split('.').pop() || 'jpg';
        const uniqueId = generateNanoId();
        // Filename is just nanoid.extension (no media/ prefix unless required)
        const fileName = uniqueId + '.' + fileExtension;
        
        // Step 1: Get signed URL from API
        // Endpoint: https://api.chromastudio.ai/get-emd-upload-url?fileName=...
        const signedUrlResponse = await fetch(
            'https://api.chromastudio.ai/get-emd-upload-url?fileName=' + encodeURIComponent(fileName),
            { method: 'GET' }
        );
        
        if (!signedUrlResponse.ok) {
            throw new Error('Failed to get signed URL: ' + signedUrlResponse.statusText);
        }
        
        const signedUrl = await signedUrlResponse.text();
        console.log('Got signed URL');
        
        // Step 2: PUT file to signed URL
        const uploadResponse = await fetch(signedUrl, {
            method: 'PUT',
            body: file,
            headers: {
                'Content-Type': file.type
            }
        });
        
        if (!uploadResponse.ok) {
            throw new Error('Failed to upload file: ' + uploadResponse.statusText);
        }
        
        // Step 3: Return download URL
        // Domain: contents.maxstudio.ai
        const downloadUrl = 'https://contents.maxstudio.ai/' + fileName;
        console.log('Uploaded to:', downloadUrl);
        return downloadUrl;
    }

    // Submit generation job
    async function submitImageGenJob(imageUrl) {
        // Check if config dictates video (based on prompt instruction logic)
        const isVideo = MODEL_TYPE === 'video-effects'; 
        const endpoint = isVideo ? 'https://api.chromastudio.ai/video-gen' : 'https://api.chromastudio.ai/image-gen';
        
        const headers = {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'sec-ch-ua-platform': '"Windows"',
            'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
            'sec-ch-ua-mobile': '?0'
        };

        // Construct payload
        let body = {};
        if (isVideo) {
            body = {
                imageUrl: [imageUrl],
                effectId: EFFECT_ID,
                userId: USER_ID,
                removeWatermark: true,
                model: 'video-effects',
                isPrivate: true
            };
        } else {
            body = {
                model: MODEL_TYPE,
                toolType: MODEL_TYPE,
                effectId: EFFECT_ID,
                imageUrl: imageUrl,
                userId: USER_ID,
                removeWatermark: true,
                isPrivate: true
            };
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            throw new Error('Failed to submit job: ' + response.statusText);
        }
        
        const data = await response.json();
        console.log('Job submitted:', data.jobId, 'Status:', data.status);
        return data;
    }

    // Poll job status until completed or failed
    const POLL_INTERVAL = 2000; // 2 seconds
    const MAX_POLLS = 60; // Max 2 minutes of polling

    async function pollJobStatus(jobId) {
        const isVideo = MODEL_TYPE === 'video-effects';
        const baseUrl = isVideo ? 'https://api.chromastudio.ai/video-gen' : 'https://api.chromastudio.ai/image-gen';
        let polls = 0;
        
        while (polls < MAX_POLLS) {
            const response = await fetch(
                `${baseUrl}/${USER_ID}/${jobId}/status`,
                {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json, text/plain, */*'
                    }
                }
            );
            
            if (!response.ok) {
                throw new Error('Failed to check status: ' + response.statusText);
            }
            
            const data = await response.json();
            console.log('Poll', polls + 1, '- Status:', data.status);
            
            if (data.status === 'completed') {
                // Handle various response schemas
                const resultItem = Array.isArray(data.result) ? data.result[0] : data.result;
                const resultUrl = resultItem?.mediaUrl || resultItem?.video || resultItem?.image;
                console.log('Job completed! Result:', resultUrl);
                
                // Normalize result structure for return
                return { status: 'completed', result: [{ image: resultUrl }] };
            }
            
            if (data.status === 'failed' || data.status === 'error') {
                throw new Error(data.error || 'Job processing failed');
            }
            
            // Update UI with progress
            updateStatus('PROCESSING... (' + (polls + 1) + ')');
            
            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            polls++;
        }
        
        throw new Error('Job timed out after ' + MAX_POLLS + ' polls');
    }

    // =========================================
    // UI HELPER FUNCTIONS
    // =========================================

    function showLoading() {
        const loader = document.getElementById('loading-state');
        const resultContainer = document.getElementById('result-container');
        const placeholderText = document.querySelector('.placeholder-text');
        
        if (loader) loader.classList.remove('hidden');
        if (loader) loader.style.display = 'flex'; // Ensure flex for centering
        if (resultContainer) resultContainer.classList.add('loading');
        if (placeholderText) placeholderText.style.display = 'none';
        
        const resultFinal = document.getElementById('result-final');
        if (resultFinal) resultFinal.classList.add('hidden');
    }

    function hideLoading() {
        const loader = document.getElementById('loading-state');
        const resultContainer = document.getElementById('result-container');
        
        if (loader) loader.classList.add('hidden');
        if (loader) loader.style.display = 'none';
        if (resultContainer) resultContainer.classList.remove('loading');
    }

    function updateStatus(text) {
        // Update loading text if it exists
        const statusText = loader?.querySelector('p') || document.querySelector('.status-text');
        if (statusText) statusText.textContent = text;
        
        // Update button text
        const generateBtn = document.getElementById('generate-btn');
        if (generateBtn) {
            if (text.includes('PROCESSING') || text.includes('UPLOADING') || text.includes('SUBMITTING')) {
                generateBtn.disabled = true;
                generateBtn.textContent = text;
            } else if (text === 'READY') {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Stencil';
                generateBtn.classList.remove('hidden');
            } else if (text === 'COMPLETE') {
                generateBtn.classList.add('hidden');
            }
        }
    }

    function showError(msg) {
        alert('Error: ' + msg); 
        const generateBtn = document.getElementById('generate-btn');
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Stencil';
        }
    }

    function showPreview(url) {
        const img = document.getElementById('preview-image');
        const uploadContent = document.querySelector('.upload-content');
        if (img) {
            img.src = url;
            img.classList.remove('hidden');
            img.style.display = 'block';
        }
        if (uploadContent) {
            uploadContent.classList.add('hidden');
        }
        // Hide placeholder text
        const placeholder = document.querySelector('.placeholder-text');
        if (placeholder) placeholder.style.display = 'none';
    }

    function showResultMedia(url) {
        const resultImg = document.getElementById('result-final');
        const container = document.getElementById('result-container');
        
        if (!container) return;
        
        // Ensure container is visible
        container.classList.remove('hidden');

        // Check for video (unlikely for stencil, but good for robustness)
        const isVideo = url.toLowerCase().match(/\.(mp4|webm)(\?.*)?$/i);
        
        if (isVideo) {
            if (resultImg) resultImg.classList.add('hidden');
            
            let video = document.getElementById('result-video');
            if (!video) {
                video = document.createElement('video');
                video.id = 'result-video';
                video.controls = true;
                video.autoplay = true;
                video.loop = true;
                video.className = resultImg ? resultImg.className : 'w-full h-auto rounded-lg';
                container.appendChild(video);
            }
            video.src = url;
            video.style.display = 'block';
        } else {
            const video = document.getElementById('result-video');
            if (video) video.style.display = 'none';
            
            if (resultImg) {
                resultImg.classList.remove('hidden');
                resultImg.style.display = 'block';
                resultImg.style.filter = ''; // Remove any previous CSS filters
                // Load normally (no crossOrigin) for display
                resultImg.src = url + '?t=' + new Date().getTime();
            }
        }
        
        // Show reset button
        const resetBtn = document.getElementById('reset-btn');
        if (resetBtn) resetBtn.classList.remove('hidden');
    }

    function showDownloadButton(url) {
        const downloadBtn = document.getElementById('download-btn');
        if (downloadBtn) {
            downloadBtn.dataset.url = url;
            downloadBtn.classList.remove('disabled');
            downloadBtn.style.display = 'inline-flex';
            // Remove href to prevent default link behavior, we handle it via click
            downloadBtn.removeAttribute('href');
        }
    }

    function enableGenerateButton() {
        const generateBtn = document.getElementById('generate-btn');
        if (generateBtn) {
            generateBtn.classList.remove('hidden');
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Stencil';
        }
    }

    // =========================================
    // CORE LOGIC HANDLERS
    // =========================================

    // Handler when file is selected - uploads immediately
    async function handleFileSelect(file) {
        if (!file) return;
        
        // Basic validation
        if (!file.type.startsWith('image/')) {
            alert('Please upload an image file.');
            return;
        }

        try {
            // Show local preview immediately using FileReader for better UX
            const reader = new FileReader();
            reader.onload = function(e) {
                showPreview(e.target.result);
            }
            reader.readAsDataURL(file);

            showLoading();
            updateStatus('UPLOADING...');
            
            // Upload to Cloud
            const uploadedUrl = await uploadFile(file);
            currentUploadedUrl = uploadedUrl;
            
            // Ensure preview is now using the cloud URL (optional, ensures consistency)
            // showPreview(uploadedUrl); 
            
            updateStatus('READY');
            hideLoading();
            
            // Enable the generate button
            enableGenerateButton();
            
        } catch (error) {
            hideLoading();
            updateStatus('ERROR');
            showError(error.message);
        }
    }

    // Handler when Generate button is clicked
    async function handleGenerate() {
        if (!currentUploadedUrl) {
            alert('Please upload an image first.');
            return;
        }
        
        try {
            showLoading();
            updateStatus('SUBMITTING JOB...');
            
            // Step 1: Submit job to ChromaStudio API
            const jobData = await submitImageGenJob(currentUploadedUrl);
            console.log('Job ID:', jobData.jobId);
            
            updateStatus('PROCESSING... (1)');
            
            // Step 2: Poll for completion
            const result = await pollJobStatus(jobData.jobId);
            
            // Extract URL from result
            const resultItem = Array.isArray(result.result) ? result.result[0] : result.result;
            const resultUrl = resultItem?.mediaUrl || resultItem?.video || resultItem?.image;
            
            if (!resultUrl) {
                console.error('Response:', result);
                throw new Error('No media URL in response');
            }
            
            console.log('Final Result URL:', resultUrl);
            
            // Step 3: Display result
            showResultMedia(resultUrl);
            
            updateStatus('COMPLETE');
            hideLoading();
            showDownloadButton(resultUrl);
            
        } catch (error) {
            hideLoading();
            updateStatus('ERROR');
            showError(error.message);
        }
    }

    // =========================================
    // PLAYGROUND WIRING
    // =========================================
    const fileInput = document.getElementById('file-input');
    const uploadZone = document.getElementById('upload-zone');
    const generateBtn = document.getElementById('generate-btn');
    const resetBtn = document.getElementById('reset-btn');
    const downloadBtn = document.getElementById('download-btn');
    const loader = document.getElementById('loading-state');

    // File Input Change
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleFileSelect(file);
        });
    }

    // Drag & Drop
    if (uploadZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            uploadZone.addEventListener(eventName, () => {
                uploadZone.classList.add('highlight');
                uploadZone.style.borderColor = 'var(--primary)';
                uploadZone.style.backgroundColor = '#f9f9f9';
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadZone.addEventListener(eventName, () => {
                uploadZone.classList.remove('highlight');
                uploadZone.style.borderColor = '';
                uploadZone.style.backgroundColor = '';
            });
        });

        uploadZone.addEventListener('drop', (e) => {
            const file = e.dataTransfer.files[0];
            if (file) handleFileSelect(file);
        });
        
        // Click to upload
        uploadZone.addEventListener('click', () => {
            if (fileInput) fileInput.click();
        });
    }

    // Generate Button
    if (generateBtn) {
        generateBtn.addEventListener('click', handleGenerate);
    }

    // Reset Button
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            // Reset Global State
            currentUploadedUrl = null;
            if (fileInput) fileInput.value = '';

            // Reset UI
            const previewImage = document.getElementById('preview-image');
            const uploadContent = document.querySelector('.upload-content');
            const resultFinal = document.getElementById('result-final');
            const placeholderText = document.querySelector('.placeholder-text');
            const video = document.getElementById('result-video');

            if (previewImage) {
                previewImage.src = '';
                previewImage.classList.add('hidden');
                previewImage.style.display = 'none';
            }
            if (uploadContent) uploadContent.classList.remove('hidden');
            
            if (resultFinal) {
                resultFinal.classList.add('hidden');
                resultFinal.src = '';
                resultFinal.style.filter = '';
            }
            if (video) video.style.display = 'none';
            if (placeholderText) placeholderText.style.display = 'block';
            
            if (generateBtn) {
                generateBtn.classList.remove('hidden');
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Stencil';
            }
            if (resetBtn) resetBtn.classList.add('hidden');
            
            if (downloadBtn) {
                downloadBtn.classList.add('disabled');
                downloadBtn.style.display = 'none'; // Or add/remove 'hidden' class based on CSS
            }
            
            hideLoading();
        });
    }

    // Download Button - Robust Implementation
    if (downloadBtn) {
        downloadBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const url = downloadBtn.dataset.url;
            if (!url) return;
            
            const originalText = downloadBtn.textContent;
            downloadBtn.textContent = 'Downloading...';
            downloadBtn.classList.add('disabled');
            
            // Helper to trigger download from blob
            function downloadBlob(blob, filename) {
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = filename;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
            }
            
            // Helper to get extension
            function getExtension(url, contentType) {
                if (contentType) {
                    if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
                    if (contentType.includes('png')) return 'png';
                    if (contentType.includes('webp')) return 'webp';
                    if (contentType.includes('mp4')) return 'mp4';
                    if (contentType.includes('webm')) return 'webm';
                }
                const match = url.match(/\.(jpe?g|png|webp|mp4|webm)/i);
                return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
            }
            
            try {
                // STRATEGY 1: Use ChromaStudio download proxy
                const proxyUrl = 'https://api.chromastudio.ai/download-proxy?url=' + encodeURIComponent(url);
                
                const response = await fetch(proxyUrl);
                if (!response.ok) throw new Error('Proxy failed: ' + response.status);
                
                const blob = await response.blob();
                const ext = getExtension(url, response.headers.get('content-type'));
                downloadBlob(blob, 'stencil_result_' + generateNanoId(8) + '.' + ext);
                
            } catch (proxyErr) {
                console.warn('Proxy download failed, trying direct fetch:', proxyErr.message);
                
                // STRATEGY 2: Try direct fetch
                try {
                    const fetchUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
                    const response = await fetch(fetchUrl, { mode: 'cors' });
                    
                    if (response.ok) {
                        const blob = await response.blob();
                        const ext = getExtension(url, response.headers.get('content-type'));
                        downloadBlob(blob, 'stencil_result_' + generateNanoId(8) + '.' + ext);
                        return;
                    }
                    throw new Error('Direct fetch failed: ' + response.status);
                } catch (fetchErr) {
                    console.warn('Direct fetch failed:', fetchErr.message);
                    
                    // STRATEGY 3: Canvas approach (Images only)
                    const img = document.getElementById('result-final');
                    if (img && img.src && !img.classList.contains('hidden')) {
                        
                        function tryCanvasWithCORS() {
                            const tempImg = new Image();
                            tempImg.crossOrigin = 'anonymous';
                            tempImg.onload = function() {
                                const canvas = document.createElement('canvas');
                                canvas.width = tempImg.naturalWidth;
                                canvas.height = tempImg.naturalHeight;
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(tempImg, 0, 0);
                                canvas.toBlob((blob) => {
                                    if (blob) {
                                        downloadBlob(blob, 'stencil_result_' + generateNanoId(8) + '.png');
                                    } else {
                                        forceDownloadLink();
                                    }
                                }, 'image/png');
                            };
                            tempImg.onerror = forceDownloadLink;
                            tempImg.src = url + (url.includes('?') ? '&' : '?') + 'crossorigin=' + Date.now();
                        }
                        
                        // STRATEGY 4: Force link
                        function forceDownloadLink() {
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = 'stencil_result_' + generateNanoId(8) + '.png';
                            link.style.display = 'none';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            setTimeout(() => {
                                alert('Download started. If not, right-click the image and select "Save Image As".');
                            }, 500);
                        }

                        // Try canvas with CORS
                        tryCanvasWithCORS();
                    } else {
                        // Fallback for non-images or hidden images
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = 'download';
                        link.click();
                    }
                }
            } finally {
                downloadBtn.textContent = originalText;
                downloadBtn.classList.remove('disabled');
            }
        });
    }

    // =========================================
    // EXISTING SITE LOGIC (Navigation, Accrodion, etc.)
    // =========================================
    
    // Navigation
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('header nav');
    const navLinks = document.querySelectorAll('header nav a');

    if (menuToggle && nav) {
        menuToggle.addEventListener('click', () => {
            nav.classList.toggle('active');
            menuToggle.innerHTML = nav.classList.contains('active') ? '✕' : '☰';
        });

        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                nav.classList.remove('active');
                menuToggle.innerHTML = '☰';
            });
        });
    }

    // Scroll Reveal
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.reveal-on-scroll').forEach(el => {
        observer.observe(el);
    });

    // FAQ Accordion
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        if (question) {
            question.addEventListener('click', () => {
                faqItems.forEach(otherItem => {
                    if (otherItem !== item) otherItem.classList.remove('active');
                });
                item.classList.toggle('active');
            });
        }
    });

    // Modals
    const modalTriggers = document.querySelectorAll('[data-modal-target]');
    const modalClosers = document.querySelectorAll('[data-modal-close]');
    const modals = document.querySelectorAll('.modal');

    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.add('active'), 10);
            document.body.style.overflow = 'hidden';
        }
    }

    function closeModal(modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
        }, 300);
    }

    modalTriggers.forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = trigger.getAttribute('data-modal-target');
            openModal(targetId);
        });
    });

    modalClosers.forEach(closer => {
        closer.addEventListener('click', () => {
            const modalId = closer.getAttribute('data-modal-close');
            const modal = document.getElementById(modalId);
            if (modal) closeModal(modal);
        });
    });

    modals.forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal);
        });
    });

    // Mouse Tracking
    document.addEventListener('mousemove', (e) => {
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        const heroBg = document.querySelector('.hero-bg-animation');
        if (heroBg) {
            heroBg.style.transform = `translate(${x * 10}px, ${y * 10}px)`;
        }
    });
});