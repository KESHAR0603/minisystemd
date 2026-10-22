import streamlit as st
import subprocess
import os
import glob

# Page configuration
st.set_page_config(
    page_title="Mini-Systemd Control Plane",
    page_icon="⚡",
    layout="wide"
)

st.title("⚡ Mini-Systemd Control Plane & Dashboard")
st.markdown("Real-time process supervision, directory scanning, and dependency-ordered booting powered by a **C backend** and controlled via **Python Streamlit**.")

# Layout columns
col1, col2 = st.columns([1, 2])

with col1:
    st.subheader("📁 Discovered Unit Files")
    service_files = glob.glob("services/*.service")
    
    if service_files:
        for f in service_files:
            # Read and show the file contents inside a nice code box
            with open(f, "r") as file:
                content = file.read()
            with st.expander(f"📄 {os.path.basename(f)}"):
                st.code(content, language="ini")
    else:
        st.warning("No service files found in `services/` directory.")
        
    st.markdown("---")
    run_button = st.button("🚀 Boot Mini-Systemd Daemon", type="primary", use_container_width=True)

with col2:
    st.subheader("🖥️ Daemon Live Execution Logs")
    log_container = st.empty()
    
    if run_button:
        log_container.text("Booting C daemon binary...")
        try:
            # Execute the compiled C binary and capture stdout in real time
            process = subprocess.Popen(
                ["./minisystemd"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True
            )
            
            output_lines = []
            for line in process.stdout:
                output_lines.append(line)
                # Stream the output live into the code block on the web page
                log_container.code("".join(output_lines), language="text")
            
            process.wait()
            st.success("✅ All services reaped. Daemon shut down safely.")
        except Exception as e:
            st.error(f"Failed to execute C binary. Make sure you ran `make` or `gcc` first! Error: {e}")
    else:
        log_container.info("👈 Click **'Boot Mini-Systemd Daemon'** on the left to trigger the C backend and view live process supervision logs.")
